import { getDb } from "@/lib/db";
import { licences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasRepAccess } from "@/lib/auth/repAccess";
import type { SessionPayload } from "@/lib/auth/jwt";

export interface LicenceAccess {
  ok: boolean;
  talentId?: string;
  licenceType?: string | null;
  status?: string;
}

/**
 * Returns whether the session may manage royalties for a licence — i.e. is the
 * talent on the licence, a delegated rep, or an admin. Resolves the licence's
 * talentId so callers don't trust client-supplied talent ids.
 */
export async function canManageLicenceRoyalties(
  session: SessionPayload,
  licenceId: string,
): Promise<LicenceAccess> {
  const db = getDb();
  const licence = await db
    .select({ talentId: licences.talentId, licenceType: licences.licenceType, status: licences.status })
    .from(licences)
    .where(eq(licences.id, licenceId))
    .get();

  if (!licence) return { ok: false };

  if (isAdmin(session.email) || session.sub === licence.talentId) {
    return { ok: true, ...licence };
  }
  if (session.role === "rep" && (await hasRepAccess(session.sub, licence.talentId))) {
    return { ok: true, ...licence };
  }
  return { ok: false, ...licence };
}
