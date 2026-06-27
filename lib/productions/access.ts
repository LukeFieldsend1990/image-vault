import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { productions, organisations, productionMembers } from "@/lib/db/schema";

type Db = ReturnType<typeof getDb>;

/**
 * How an industry user relates to a production they (potentially) own.
 *
 * Exactly one set of people run a production implicitly: the *production owner*
 * — the production's coordinator, plus the owning org's founder as a fallback
 * for productions created before a coordinator was recorded. They can do
 * everything, including managing the production team.
 *
 * Everyone else — including other "owner"-role members of the same org — only
 * reaches a production they've been explicitly added to (production_members),
 * and their per-production role decides whether that access is read-only
 * (viewer) or operational (editor). Crucially, being an org owner/admin does
 * NOT by itself grant access to a colleague's production.
 */
export interface OwnerAccess {
  /** May view the owner-side management surface for this production at all. */
  isMember: boolean;
  /** May perform operational mutations: cast, vendors, details, countries, insurers. */
  canWrite: boolean;
  /** May add/remove/retier production team members. Production owner only. */
  canManageTeam: boolean;
  /** True when the caller is the production owner (coordinator / org founder). */
  isOwner: boolean;
}

const NO_ACCESS: OwnerAccess = { isMember: false, canWrite: false, canManageTeam: false, isOwner: false };
const FULL: OwnerAccess = { isMember: true, canWrite: true, canManageTeam: true, isOwner: true };

/**
 * The user ids that own a production implicitly: its coordinator (the creator)
 * and the owning org's founder. Either is enough. Returns an empty set for
 * legacy productions with no owning org (handled separately by callers).
 */
export async function getProductionOwnerIds(
  db: Db,
  productionId: string,
): Promise<Set<string>> {
  const row = await db
    .select({ coordinatorId: productions.coordinatorId, orgCreatedBy: organisations.createdBy })
    .from(productions)
    .leftJoin(organisations, eq(organisations.id, productions.organisationId))
    .where(eq(productions.id, productionId))
    .get();
  const ids = new Set<string>();
  if (row?.coordinatorId) ids.add(row.coordinatorId);
  if (row?.orgCreatedBy) ids.add(row.orgCreatedBy);
  return ids;
}

/**
 * Resolve a (non-admin) industry user's access to a production. System admins
 * are handled by the callers (they always get full access) and are not passed
 * here.
 */
export async function resolveOwnerAccess(
  db: Db,
  productionId: string,
  organisationId: string | null,
  userId: string,
): Promise<OwnerAccess> {
  // Legacy productions with no owning org — mirror the historical behaviour of
  // the production routes and let any industry user manage them.
  if (!organisationId) return FULL;

  // The production owner (coordinator / org founder) runs the show and its team.
  const ownerIds = await getProductionOwnerIds(db, productionId);
  if (ownerIds.has(userId)) return FULL;

  // Anyone else only reaches a production they've been explicitly added to —
  // org role is irrelevant.
  const team = await db
    .select({ role: productionMembers.role })
    .from(productionMembers)
    .where(and(eq(productionMembers.productionId, productionId), eq(productionMembers.userId, userId)))
    .get();
  if (!team) return NO_ACCESS;

  return { isMember: true, canWrite: team.role === "editor", canManageTeam: false, isOwner: false };
}
