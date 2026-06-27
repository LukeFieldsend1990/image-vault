/**
 * Authorisation for the registered consent-document surface.
 *
 * View: the talent who owns the licence, their rep/agent, the licensee
 * (production) who issued it, or an admin.
 * Act (accept/withdraw): the talent or their rep/agent (acting on standing
 * instructions), or an admin — never the production.
 */

import { licences, talentReps } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth/adminEmails";
import type { SessionPayload } from "@/lib/auth/jwt";

type Db = ReturnType<typeof getDb>;

export interface ConsentAuth {
  licence: { id: string; talentId: string; licenseeId: string };
  canView: boolean;
  canAct: boolean;
  /** "talent" | "rep" when the actor can act on the talent's behalf. */
  actingRole: "talent" | "rep" | null;
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

  return { licence: lic, canView, canAct, actingRole };
}
