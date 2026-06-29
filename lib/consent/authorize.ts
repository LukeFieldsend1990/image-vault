/**
 * Authorisation for the registered consent-document surface.
 *
 * View: the talent who owns the licence, their rep/agent, the licensee
 * (production) who issued it, or an admin.
 * Act (accept/withdraw): the talent or their rep/agent (acting on standing
 * instructions), or an admin — never the production.
 */

import { licences, talentReps, productionCast, productions, organisationMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import type { SessionPayload } from "@/lib/auth/jwt";

type Db = ReturnType<typeof getDb>;

export interface ConsentAuth {
  licence: { id: string; talentId: string; licenseeId: string };
  canView: boolean;
  canAct: boolean;
  /** "talent" | "rep" when the actor can act on the talent's behalf. */
  actingRole: "talent" | "rep" | null;
  /** True when the caller is the production (licensee) on this licence. */
  isLicensee: boolean;
  /** Which side of the negotiation the caller sits on. */
  party: "producer" | "talent" | "rep" | "admin" | null;
}

export async function authorizeLicenceConsent(
  db: Db,
  session: SessionPayload,
  licenceId: string,
): Promise<ConsentAuth | null> {
  const lic = await db
    .select({ id: licences.id, talentId: licences.talentId, licenseeId: licences.licenseeId })
    .from(licences)
    .where(eq(licences.id, licenceId))
    .get();
  if (!lic) return null;

  const admin = isAdmin(session.email);
  const isOwnerTalent = session.sub === lic.talentId;
  const isLicensee = session.sub === lic.licenseeId;

  let isRep = false;
  if (!isOwnerTalent && !admin) {
    const link = await db
      .select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, lic.talentId)))
      .get();
    isRep = Boolean(link);
  }

  const canAct = admin || isOwnerTalent || isRep;
  const canView = canAct || isLicensee;
  const actingRole: ConsentAuth["actingRole"] = isOwnerTalent ? "talent" : isRep ? "rep" : admin ? "talent" : null;
  const party: ConsentAuth["party"] = isOwnerTalent ? "talent" : isRep ? "rep" : isLicensee ? "producer" : admin ? "admin" : null;

  return { licence: lic, canView, canAct, actingRole, isLicensee, party };
}

export interface CastConsentAuth {
  cast: { id: string; productionId: string; repId: string | null; talentId: string | null; status: string; addedBy: string };
  canView: boolean;
  /** The talent-side actor (the reserved rep) can pre-negotiate scope + send for final consent. */
  canAct: boolean;
  actingRole: "rep" | null;
  /** True when the caller is the production that holds this placeholder. */
  isProducer: boolean;
  party: "producer" | "rep" | "admin" | null;
}

/**
 * Authorise the cast-level (placeholder) consent surface. Mirrors
 * authorizeLicenceConsent but for a production-held cast row that has no licence
 * yet: the reserved rep negotiates the §39 scope with the production before the
 * performer is sent the document. Rep authority comes from production_cast.repId
 * (not talent_reps — there is no talent user yet); the producer is an owner/admin
 * of the production's org (or the coordinator who added the row).
 */
export async function authorizeCastConsent(
  db: Db,
  session: SessionPayload,
  castId: string,
): Promise<CastConsentAuth | null> {
  const cast = await db
    .select({
      id: productionCast.id,
      productionId: productionCast.productionId,
      repId: productionCast.repId,
      talentId: productionCast.talentId,
      status: productionCast.status,
      addedBy: productionCast.addedBy,
    })
    .from(productionCast)
    .where(eq(productionCast.id, castId))
    .get();
  if (!cast) return null;

  const admin = isAdmin(session.email);
  const isRep = cast.repId === session.sub;

  let isProducer = cast.addedBy === session.sub;
  if (!isProducer && !isRep && !admin && isIndustryRole(session.role)) {
    const prod = await db
      .select({ organisationId: productions.organisationId })
      .from(productions)
      .where(eq(productions.id, cast.productionId))
      .get();
    if (prod?.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(and(eq(organisationMembers.organisationId, prod.organisationId), eq(organisationMembers.userId, session.sub)))
        .get();
      isProducer = Boolean(membership && (membership.memberRole === "owner" || membership.memberRole === "admin"));
    }
  }

  const canAct = isRep; // only the reserved rep acts on the talent side pre-account
  const canView = canAct || isProducer || admin;
  const party: CastConsentAuth["party"] = isRep ? "rep" : isProducer ? "producer" : admin ? "admin" : null;

  return {
    cast: { id: cast.id, productionId: cast.productionId, repId: cast.repId, talentId: cast.talentId, status: cast.status, addedBy: cast.addedBy },
    canView,
    canAct,
    actingRole: isRep ? "rep" : null,
    isProducer,
    party,
  };
}
