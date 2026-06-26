import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { organisationMembers, productionMembers } from "@/lib/db/schema";

type Db = ReturnType<typeof getDb>;

/**
 * How an industry user relates to a production they (potentially) own.
 *
 * The owning organisation's owner/admin members run every production the org
 * owns — they can do everything, including managing the production team. Plain
 * "member"-role colleagues only reach a production they've been explicitly added
 * to (production_members), and their per-production role decides whether that
 * access is read-only (viewer) or operational (editor).
 */
export interface OwnerAccess {
  /** May view the owner-side management surface for this production at all. */
  isMember: boolean;
  /** May perform operational mutations: cast, vendors, details, countries, insurers. */
  canWrite: boolean;
  /** May add/remove/retier production team members. Org owner/admin only. */
  canManageTeam: boolean;
  /** The caller's role in the owning org, when known. */
  orgRole: "owner" | "admin" | "member" | null;
}

const NO_ACCESS: OwnerAccess = { isMember: false, canWrite: false, canManageTeam: false, orgRole: null };

/**
 * Resolve a (non-admin) industry user's access to a production from its owning
 * org membership and any explicit production-team entry. System admins are
 * handled by the callers (they always get full access) and are not passed here.
 */
export async function resolveOwnerAccess(
  db: Db,
  productionId: string,
  organisationId: string | null,
  userId: string,
): Promise<OwnerAccess> {
  // Legacy productions with no owning org — mirror the historical behaviour of
  // the production routes and let any industry user manage them.
  if (!organisationId) {
    return { isMember: true, canWrite: true, canManageTeam: true, orgRole: null };
  }

  const membership = await db
    .select({ r: organisationMembers.memberRole })
    .from(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, organisationId), eq(organisationMembers.userId, userId)))
    .get();
  if (!membership) return NO_ACCESS;

  // Org owners/admins run the org's productions and manage their teams.
  if (membership.r === "owner" || membership.r === "admin") {
    return { isMember: true, canWrite: true, canManageTeam: true, orgRole: membership.r };
  }

  // Plain org members only reach a production they've been explicitly added to.
  const team = await db
    .select({ role: productionMembers.role })
    .from(productionMembers)
    .where(and(eq(productionMembers.productionId, productionId), eq(productionMembers.userId, userId)))
    .get();
  if (!team) return { ...NO_ACCESS, orgRole: "member" };

  return { isMember: true, canWrite: team.role === "editor", canManageTeam: false, orgRole: "member" };
}
