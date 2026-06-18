import { getDb } from "@/lib/db";
import { complianceGrants, users } from "@/lib/db/schema";
import { and, eq, isNull, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isComplianceRole } from "@/lib/auth/roles";

type Db = ReturnType<typeof getDb>;

export const COMPLIANCE_SUBTYPES = ["union", "regulator", "insurer"] as const;
export const COMPLIANCE_SCOPES = ["platform", "organisation", "production", "talent"] as const;
export type ComplianceSubtype = (typeof COMPLIANCE_SUBTYPES)[number];
export type ComplianceScope = (typeof COMPLIANCE_SCOPES)[number];

/**
 * Insurance is bound per production, so an insurer must only ever see the
 * productions (or, rarely, the single performer) it covers — never an org-wide
 * or platform-wide view. Enforce this at the data layer, not just in the UI:
 * any caller (admins included) is refused an insurer grant outside these scopes.
 */
export const INSURER_ALLOWED_SCOPES: readonly ComplianceScope[] = ["production", "talent"];

export function isAllowedScopeForSubtype(subtype: string, scope: string): boolean {
  if (subtype === "insurer") return (INSURER_ALLOWED_SCOPES as readonly string[]).includes(scope);
  return (COMPLIANCE_SCOPES as readonly string[]).includes(scope);
}

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

/** Whether a compliance user holds an active platform-wide grant. */
export async function hasPlatformGrant(db: Db, userId: string): Promise<boolean> {
  const grants = await getActiveGrants(db, userId);
  return grants.some((g) => g.scope === "platform");
}

/**
 * Whether a session may use the platform-wide oversight surfaces (platform
 * compliance dashboard, productions tracker, cast visibility): admins always, and
 * compliance watchers only while holding an active platform-wide grant.
 */
export async function canViewPlatformOversight(
  db: Db,
  session: { sub: string; email: string; role: string },
): Promise<boolean> {
  if (isAdmin(session.email)) return true;
  if (isComplianceRole(session.role)) return hasPlatformGrant(db, session.sub);
  return false;
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

export interface ScopeGrant {
  id: string;
  complianceUserId: string;
  email: string | null;
  subtype: string;
  createdAt: number;
}

/**
 * Active grants on a given (scope, scopeId), optionally filtered by subtype.
 * Used to list, e.g., the insurers attached to one production.
 */
export async function listGrantsForScope(
  db: Db,
  scope: ComplianceScope,
  scopeId: string,
  subtype?: ComplianceSubtype,
): Promise<ScopeGrant[]> {
  const watcher = alias(users, "watcher");
  const conditions = [
    eq(complianceGrants.scope, scope),
    eq(complianceGrants.scopeId, scopeId),
    isNull(complianceGrants.revokedAt),
  ];
  if (subtype) conditions.push(eq(complianceGrants.subtype, subtype));

  return db
    .select({
      id: complianceGrants.id,
      complianceUserId: complianceGrants.complianceUserId,
      email: watcher.email,
      subtype: complianceGrants.subtype,
      createdAt: complianceGrants.createdAt,
    })
    .from(complianceGrants)
    .leftJoin(watcher, eq(watcher.id, complianceGrants.complianceUserId))
    .where(and(...conditions))
    .orderBy(desc(complianceGrants.createdAt))
    .all();
}

export class GrantScopeError extends Error {}

/**
 * Create a compliance grant, enforcing the per-subtype scope rules (see
 * INSURER_ALLOWED_SCOPES). Returns the new grant id. Throws GrantScopeError if
 * the scope is not permitted for the subtype, so callers map it to a 400.
 * Idempotent: if an identical active grant exists, returns it instead of duplicating.
 */
export async function createGrant(
  db: Db,
  params: {
    complianceUserId: string;
    subtype: ComplianceSubtype;
    scope: ComplianceScope;
    scopeId: string | null;
    grantedBy: string | null;
  },
): Promise<string> {
  if (!isAllowedScopeForSubtype(params.subtype, params.scope)) {
    throw new GrantScopeError(
      `${params.subtype} grants are limited to scopes: ${
        params.subtype === "insurer" ? INSURER_ALLOWED_SCOPES.join(" | ") : COMPLIANCE_SCOPES.join(" | ")
      }`,
    );
  }

  const scopeId = params.scope === "platform" ? null : params.scopeId;

  const existing = await db
    .select({ id: complianceGrants.id })
    .from(complianceGrants)
    .where(
      and(
        eq(complianceGrants.complianceUserId, params.complianceUserId),
        eq(complianceGrants.subtype, params.subtype),
        eq(complianceGrants.scope, params.scope),
        scopeId === null ? isNull(complianceGrants.scopeId) : eq(complianceGrants.scopeId, scopeId),
        isNull(complianceGrants.revokedAt),
      ),
    )
    .get();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  await db.insert(complianceGrants).values({
    id,
    complianceUserId: params.complianceUserId,
    subtype: params.subtype,
    scope: params.scope,
    scopeId,
    grantedBy: params.grantedBy,
    createdAt: Math.floor(Date.now() / 1000),
  });
  return id;
}

/** Revoke a grant (soft). Returns false if not found or already revoked. */
export async function revokeGrant(db: Db, grantId: string): Promise<boolean> {
  const row = await db
    .select({ id: complianceGrants.id, revokedAt: complianceGrants.revokedAt })
    .from(complianceGrants)
    .where(eq(complianceGrants.id, grantId))
    .get();
  if (!row || row.revokedAt) return false;
  await db
    .update(complianceGrants)
    .set({ revokedAt: Math.floor(Date.now() / 1000) })
    .where(eq(complianceGrants.id, grantId));
  return true;
}
