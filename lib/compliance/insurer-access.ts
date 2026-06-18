import { getDb } from "@/lib/db";
import { isComplianceRole } from "@/lib/auth/roles";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getInsurerProductionGrants } from "./grants";

type Db = ReturnType<typeof getDb>;

export interface InsurerAccess {
  /** True if the caller may view this production's underwriting surface. */
  allowed: boolean;
  /** The insurer grant id authorising the caller, if any (null for admins). */
  grantId: string | null;
  isAdmin: boolean;
}

/**
 * Resolve whether a session may access one production's insurer surfaces. A
 * compliance watcher is authorised only by an active insurer grant on that exact
 * production (never platform-wide — insurer grants can't be platform-scoped).
 * Admins may view but hold no grant.
 */
export async function resolveInsurerAccess(
  db: Db,
  session: { sub: string; email: string; role: string },
  productionId: string,
): Promise<InsurerAccess> {
  if (isAdmin(session.email)) return { allowed: true, grantId: null, isAdmin: true };
  if (!isComplianceRole(session.role)) return { allowed: false, grantId: null, isAdmin: false };
  const grants = await getInsurerProductionGrants(db, session.sub);
  const match = grants.find((g) => g.productionId === productionId);
  return { allowed: !!match, grantId: match?.grantId ?? null, isAdmin: false };
}
