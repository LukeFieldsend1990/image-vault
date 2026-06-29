/**
 * Consent-document view-model loaders.
 *
 * Two entry points resolve to the same shape so one client component can render
 * both:
 *   - by licence id  → a registered performer (or their agent) reviewing a real
 *     licence's consent document.
 *   - by cast id     → an unregistered production-held performer arriving via a
 *     tokenised public link, before any licence/account exists.
 */

import {
  licences,
  productions,
  productionCast,
  organisations,
  talentProfiles,
  users,
  consentRecords,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { buildConsentDocCopy, type ConsentDocCopy } from "./document";
import { parseUseCategoryIds, type UseCategoryId } from "./use-categories";
import { loadProductionDefaultTerms } from "@/lib/productions/cast";

type Db = ReturnType<typeof getDb>;

export interface ConsentDocViewModel {
  mode: "licence" | "cast";
  licenceId: string | null;
  castId: string | null;
  productionId: string | null;
  productionName: string;
  companyName: string;
  performerName: string;
  /** Use categories the production requested — pre-ticked. */
  requestedScope: UseCategoryId[];
  /** Use categories already consented to (from the ledger or a prior acceptance). */
  currentConsents: UseCategoryId[];
  /** Whether the performer has already confirmed this document. */
  alreadyAccepted: boolean;
  status: string;
  /** Cast mode: name of the reserved rep/agent, if one is managing this placeholder. */
  repName: string | null;
  /** Cast mode: the performer's recorded custody election, once made. */
  custodyChoice: "self" | "rep_managed" | null;
  copy: ConsentDocCopy;
}

/** Load the consent document for a registered performer's licence. */
export async function loadConsentDocByLicence(db: Db, licenceId: string): Promise<ConsentDocViewModel | null> {
  const lic = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      useCategoriesJson: licences.useCategoriesJson,
      status: licences.status,
      productionId: licences.productionId,
    })
    .from(licences)
    .where(eq(licences.id, licenceId))
    .get();
  if (!lic) return null;

  const profile = await db
    .select({ fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, lic.talentId))
    .get();
  const user = profile
    ? null
    : await db.select({ email: users.email }).from(users).where(eq(users.id, lic.talentId)).get();
  const performerName = profile?.fullName || user?.email || "you";

  const requestedScope = parseUseCategoryIds(lic.useCategoriesJson);

  // Currently-granted category consents from the ledger projection.
  const records = await db
    .select({ useType: consentRecords.useType, status: consentRecords.status })
    .from(consentRecords)
    .where(eq(consentRecords.licenceId, lic.id))
    .all();
  const currentConsents = parseUseCategoryIds(
    JSON.stringify(records.filter((r) => r.status === "granted").map((r) => r.useType)),
  );

  const alreadyAccepted = lic.status === "APPROVED" || currentConsents.length > 0;

  return {
    mode: "licence",
    licenceId: lic.id,
    castId: null,
    productionId: lic.productionId,
    productionName: lic.projectName,
    companyName: lic.productionCompany,
    performerName,
    requestedScope,
    currentConsents: currentConsents.length ? currentConsents : requestedScope,
    alreadyAccepted,
    status: lic.status,
    repName: null,
    custodyChoice: null,
    copy: buildConsentDocCopy({ productionName: lic.projectName, companyName: lic.productionCompany, performerName }),
  };
}

/** Load the consent document for an unregistered, production-held cast row. */
export async function loadConsentDocByCast(db: Db, castId: string): Promise<ConsentDocViewModel | null> {
  const cast = await db
    .select({
      id: productionCast.id,
      productionId: productionCast.productionId,
      actorName: productionCast.actorName,
      status: productionCast.status,
      licenceTermsJson: productionCast.licenceTermsJson,
      repId: productionCast.repId,
      custodyChoice: productionCast.custodyChoice,
    })
    .from(productionCast)
    .where(eq(productionCast.id, castId))
    .get();
  if (!cast) return null;

  let repName: string | null = null;
  if (cast.repId) {
    const rep = await db
      .select({ fullName: talentProfiles.fullName, email: users.email })
      .from(users)
      .leftJoin(talentProfiles, eq(talentProfiles.userId, users.id))
      .where(eq(users.id, cast.repId))
      .get();
    repName = rep?.fullName || rep?.email || null;
  }

  const prod = await db
    .select({ name: productions.name, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, cast.productionId))
    .get();

  let companyName = "the production company";
  let requestedScope: UseCategoryId[] = [];
  let projectName = prod?.name ?? "this production";

  if (cast.licenceTermsJson) {
    try {
      const terms = JSON.parse(cast.licenceTermsJson) as {
        projectName?: string;
        productionCompany?: string;
        useCategoryIds?: string[];
      };
      if (terms.projectName) projectName = terms.projectName;
      if (terms.productionCompany) companyName = terms.productionCompany;
      requestedScope = parseUseCategoryIds(JSON.stringify(terms.useCategoryIds ?? []));
    } catch {
      /* fall through to org lookup */
    }
  }
  // A reserved placeholder may carry no row-level scope — the §39 ask lives in the
  // production's default terms. Fall back to those so the document shows the same
  // requested uses the eventual licence will carry (promoteCastMember uses the same
  // row-over-defaults precedence).
  if (requestedScope.length === 0) {
    const defaults = await loadProductionDefaultTerms(db, cast.productionId);
    if (defaults.useCategoryIds?.length) requestedScope = defaults.useCategoryIds;
  }
  if (companyName === "the production company" && prod?.organisationId) {
    const org = await db
      .select({ name: organisations.name })
      .from(organisations)
      .where(eq(organisations.id, prod.organisationId))
      .get();
    if (org?.name) companyName = org.name;
  }

  const performerName = cast.actorName || "you";
  const alreadyAccepted = cast.status === "consented";

  return {
    mode: "cast",
    licenceId: null,
    castId: cast.id,
    productionId: cast.productionId,
    productionName: projectName,
    companyName,
    performerName,
    requestedScope,
    currentConsents: requestedScope,
    alreadyAccepted,
    status: cast.status,
    repName,
    custodyChoice: (cast.custodyChoice as "self" | "rep_managed" | null) ?? null,
    copy: buildConsentDocCopy({ productionName: projectName, companyName, performerName }),
  };
}
