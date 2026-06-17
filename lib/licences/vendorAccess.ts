import { getDb } from "@/lib/db";
import { organisationMembers, vendorAuthorisations } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { SessionPayload } from "@/lib/auth/jwt";

type Db = ReturnType<typeof getDb>;

interface LicenceSide {
  licenseeId: string;
  organisationId: string | null;
}

/**
 * The "production side" of a licence — the party that holds it and may authorise
 * vendors: the individual licensee, an owner/admin of the licensee org, or a
 * platform admin.
 */
export async function isProductionSideOfLicence(
  db: Db,
  session: SessionPayload,
  licence: LicenceSide
): Promise<boolean> {
  if (session.role === "admin") return true;
  if (session.sub === licence.licenseeId) return true;
  if (licence.organisationId) {
    const m = await db
      .select({ memberRole: organisationMembers.memberRole })
      .from(organisationMembers)
      .where(and(eq(organisationMembers.organisationId, licence.organisationId), eq(organisationMembers.userId, session.sub)))
      .get();
    if (m && (m.memberRole === "owner" || m.memberRole === "admin")) return true;
  }
  return false;
}

/** Whether the user is a member of the given organisation (any member role). */
export async function isOrgMember(db: Db, userId: string, orgId: string): Promise<boolean> {
  const m = await db
    .select({ userId: organisationMembers.userId })
    .from(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, orgId), eq(organisationMembers.userId, userId)))
    .get();
  return !!m;
}

/** Active vendor org ids authorised to pull a given licence (direct + sub-vendors). */
export async function getAuthorisedVendorOrgIds(db: Db, licenceId: string): Promise<Set<string>> {
  const rows = await db
    .select({ vendorOrgId: vendorAuthorisations.vendorOrgId })
    .from(vendorAuthorisations)
    .where(and(eq(vendorAuthorisations.licenceId, licenceId), eq(vendorAuthorisations.status, "active")))
    .all();
  return new Set(rows.map((r) => r.vendorOrgId));
}
