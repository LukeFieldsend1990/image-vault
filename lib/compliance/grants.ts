import { getDb } from "@/lib/db";
import { complianceGrants } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

export interface ActiveGrant {
  id: string;
  subtype: string;
  scope: string;
  scopeId: string | null;
  createdAt: number;
}

/** Active (non-revoked) grants for a compliance user. */
export async function getActiveGrants(db: Db, userId: string): Promise<ActiveGrant[]> {
  return db
    .select({
      id: complianceGrants.id,
      subtype: complianceGrants.subtype,
      scope: complianceGrants.scope,
      scopeId: complianceGrants.scopeId,
      createdAt: complianceGrants.createdAt,
    })
    .from(complianceGrants)
    .where(and(eq(complianceGrants.complianceUserId, userId), isNull(complianceGrants.revokedAt)))
    .all();
}

/**
 * Whether a compliance user may view evidence for (scope, scopeId).
 * A platform-wide grant authorises any scope; otherwise the grant must match the
 * requested scope + id exactly.
 */
export async function hasGrantForScope(
  db: Db,
  userId: string,
  scope: string,
  scopeId: string,
): Promise<boolean> {
  const grants = await getActiveGrants(db, userId);
  return grants.some(
    (g) => g.scope === "platform" || (g.scope === scope && g.scopeId === scopeId),
  );
}
