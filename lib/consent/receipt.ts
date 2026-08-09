/**
 * The consent receipt — the artifact a performer keeps.
 *
 * Until now, confirming consent produced a database row and a banner. The
 * performer walked away with nothing: no statement of what they agreed to, no
 * statement of what they refused, and no way to prove either later. This builds
 * that statement from what was already being recorded.
 *
 * Two things are deliberate:
 *
 *  1. **Withheld uses are enumerated, not implied.** The whole taxonomy is
 *     partitioned into granted and withheld, so the receipt says what was
 *     refused rather than leaving it to be inferred from an absence. In a
 *     dispute the refusal is the operative half.
 *
 *  2. **The ledger position is carried through.** Where the acceptance has been
 *     written to the hash chain, the receipt names the chain, sequence, and hash
 *     of each grant, so the paper can be tied back to the ledger entry it came
 *     from. Guest acceptances have no chain yet — the receipt says so plainly
 *     rather than implying a seal that does not exist.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  complianceEvents,
  consentAcceptances,
  consentRecords,
  licences,
  organisations,
  productionCast,
  productions,
  talentProfiles,
  users,
} from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import { buildConsentDocCopy } from "./document";
import { USE_CATEGORIES, normaliseUseCategoryIds, type UseCategory } from "./use-categories";

type Db = ReturnType<typeof getDb>;

export interface ReceiptUse extends Pick<UseCategory, "id" | "name" | "description" | "regimeTag" | "sensitive"> {
  /** Ledger position of the grant, when the acceptance has been chained. */
  ledger: { chainKey: string; seq: number; hash: string } | null;
  /** When this specific use was granted (unix seconds). */
  grantedAt: number | null;
}

export interface ConsentReceipt {
  id: string;
  /** Human document reference, e.g. CR-20260808-A3F1C2. */
  reference: string;

  performerName: string;
  performerEmail: string | null;
  productionName: string;
  companyName: string;

  acceptedByEmail: string | null;
  acceptedByRole: "talent" | "rep" | "guest";
  /** True when an agent confirmed on the performer's behalf. */
  onBehalf: boolean;

  granted: ReceiptUse[];
  withheld: ReceiptUse[];

  attestation: string;
  documentVersion: string;
  attestedAt: number;

  /** SHA-256 of the source IP and user-agent. The raw values are never stored. */
  ipHash: string | null;
  userAgentHash: string | null;

  /** Chains this acceptance was written to. Empty for an unreplayed guest acceptance. */
  chainKeys: string[];
  /** False when the acceptance predates any account and has not yet been chained. */
  chained: boolean;

  licenceId: string | null;
  castId: string | null;
  talentId: string | null;
}

function decorate(c: UseCategory): Omit<ReceiptUse, "ledger" | "grantedAt"> {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    regimeTag: c.regimeTag,
    sensitive: c.sensitive,
  };
}

/** Document reference for a receipt. Quotable in correspondence; not a capability. */
export function receiptReference(acceptanceId: string, attestedAt: number): string {
  const day = new Date(attestedAt * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  return `CR-${day}-${acceptanceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/**
 * Partition the full use taxonomy against a granted set.
 *
 * Exhaustive by construction: every category lands in exactly one list, in
 * canonical taxonomy order. An unknown id in the stored set is dropped by
 * `normaliseUseCategoryIds` rather than inventing a row.
 */
export function partitionUses(grantedIds: readonly string[]): {
  granted: Omit<ReceiptUse, "ledger" | "grantedAt">[];
  withheld: Omit<ReceiptUse, "ledger" | "grantedAt">[];
} {
  const set = new Set<string>(normaliseUseCategoryIds([...grantedIds]));
  const granted: Omit<ReceiptUse, "ledger" | "grantedAt">[] = [];
  const withheld: Omit<ReceiptUse, "ledger" | "grantedAt">[] = [];
  for (const c of USE_CATEGORIES) {
    (set.has(c.id) ? granted : withheld).push(decorate(c));
  }
  return { granted, withheld };
}

/**
 * Build the receipt for one acceptance. Returns null when the acceptance does
 * not exist.
 */
export async function buildConsentReceipt(db: Db, acceptanceId: string): Promise<ConsentReceipt | null> {
  const acc = await db
    .select()
    .from(consentAcceptances)
    .where(eq(consentAcceptances.id, acceptanceId))
    .get();
  if (!acc) return null;

  let grantedIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(acc.usesConsentedJson);
    if (Array.isArray(parsed)) grantedIds = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    grantedIds = [];
  }

  const { granted, withheld } = partitionUses(grantedIds);

  // ── Parties ────────────────────────────────────────────────────────────────
  let performerName = "you";
  let performerEmail: string | null = null;
  let productionName = "this production";
  let companyName = "the production company";

  if (acc.licenceId) {
    const lic = await db
      .select({
        talentId: licences.talentId,
        projectName: licences.projectName,
        productionCompany: licences.productionCompany,
      })
      .from(licences)
      .where(eq(licences.id, acc.licenceId))
      .get();
    if (lic) {
      productionName = lic.projectName;
      companyName = lic.productionCompany;
    }
  }

  const talentId = acc.talentId;
  if (talentId) {
    const [profile, user] = await Promise.all([
      db.select({ fullName: talentProfiles.fullName }).from(talentProfiles).where(eq(talentProfiles.userId, talentId)).get(),
      db.select({ email: users.email }).from(users).where(eq(users.id, talentId)).get(),
    ]);
    performerName = profile?.fullName || user?.email || performerName;
    performerEmail = user?.email ?? null;
  }

  if (acc.castId) {
    const cast = await db
      .select({ actorName: productionCast.actorName, productionId: productionCast.productionId })
      .from(productionCast)
      .where(eq(productionCast.id, acc.castId))
      .get();
    if (cast) {
      if (!talentId && cast.actorName) performerName = cast.actorName;
      const prod = await db
        .select({ name: productions.name, organisationId: productions.organisationId })
        .from(productions)
        .where(eq(productions.id, cast.productionId))
        .get();
      if (prod?.name && productionName === "this production") productionName = prod.name;
      if (prod?.organisationId && companyName === "the production company") {
        const org = await db
          .select({ name: organisations.name })
          .from(organisations)
          .where(eq(organisations.id, prod.organisationId))
          .get();
        if (org?.name) companyName = org.name;
      }
    }
  }

  if (!performerEmail && acc.acceptedByRole === "guest") performerEmail = acc.acceptedByEmail;

  // ── Ledger positions ───────────────────────────────────────────────────────
  // Each granted category has a consent_records row pointing at the ledger entry
  // that granted it. Resolve those so the receipt can cite chain, seq, and hash.
  const ledgerByUse = new Map<string, { chainKey: string; seq: number; hash: string; createdAt: number }>();

  if (acc.licenceId) {
    const records = await db
      .select({
        useType: consentRecords.useType,
        grantedEventId: consentRecords.grantedEventId,
        status: consentRecords.status,
        language: consentRecords.language,
      })
      .from(consentRecords)
      .where(and(eq(consentRecords.licenceId, acc.licenceId), eq(consentRecords.status, "granted")))
      .all();

    const eventIds = records.map((r) => r.grantedEventId).filter((id): id is string => Boolean(id));
    if (eventIds.length > 0) {
      const evs = await db
        .select({
          id: complianceEvents.id,
          chainKey: complianceEvents.chainKey,
          seq: complianceEvents.seq,
          hash: complianceEvents.hash,
          createdAt: complianceEvents.createdAt,
        })
        .from(complianceEvents)
        .where(inArray(complianceEvents.id, eventIds))
        .all();
      const byId = new Map(evs.map((e) => [e.id, e]));
      for (const r of records) {
        // Dub-language records are a separate, language-scoped grant; the base
        // category grant is the one the receipt cites.
        if (r.language) continue;
        const ev = r.grantedEventId ? byId.get(r.grantedEventId) : undefined;
        if (ev) ledgerByUse.set(r.useType, ev);
      }
    }
  }

  const attach = (rows: Omit<ReceiptUse, "ledger" | "grantedAt">[], withLedger: boolean): ReceiptUse[] =>
    rows.map((r) => {
      const ev = withLedger ? ledgerByUse.get(r.id) : undefined;
      return {
        ...r,
        ledger: ev ? { chainKey: ev.chainKey, seq: ev.seq, hash: ev.hash } : null,
        grantedAt: ev ? ev.createdAt : withLedger ? acc.attestedAt : null,
      };
    });

  const chainKeys = [...new Set([...ledgerByUse.values()].map((e) => e.chainKey))].sort();

  const copy = buildConsentDocCopy({ productionName, companyName, performerName });

  return {
    id: acc.id,
    reference: receiptReference(acc.id, acc.attestedAt),

    performerName,
    performerEmail,
    productionName,
    companyName,

    acceptedByEmail: acc.acceptedByEmail,
    acceptedByRole: acc.acceptedByRole as ConsentReceipt["acceptedByRole"],
    onBehalf: acc.acceptedByRole === "rep",

    granted: attach(granted, true),
    withheld: attach(withheld, false),

    attestation: copy.attestation,
    documentVersion: acc.documentVersion,
    attestedAt: acc.attestedAt,

    ipHash: acc.ipHash,
    userAgentHash: acc.userAgentHash,

    chainKeys,
    chained: chainKeys.length > 0,

    licenceId: acc.licenceId,
    castId: acc.castId,
    talentId: acc.talentId,
  };
}
