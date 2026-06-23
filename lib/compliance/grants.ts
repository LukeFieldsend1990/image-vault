import { getDb } from "@/lib/db";
import { complianceGrants, licences, users } from "@/lib/db/schema";
import { and, eq, isNull, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isComplianceRole } from "@/lib/auth/roles";
import { getUnionPreset } from "./unions";
import { affiliatedProductionIds, affiliatedTalentIds } from "./affiliation";

type Db = ReturnType<typeof getDb>;

export const COMPLIANCE_SUBTYPES = ["union", "regulator", "insurer"] as const;
export const COMPLIANCE_SCOPES = ["platform", "organisation", "production", "talent", "union"] as const;
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
  // The "union" scope (a union's affiliated talent + productions) only makes sense
  // for a union watcher — never a regulator or insurer.
  if (scope === "union") return subtype === "union";
  if (subtype === "insurer") return (INSURER_ALLOWED_SCOPES as readonly string[]).includes(scope);
  return (COMPLIANCE_SCOPES as readonly string[]).includes(scope);
}

export interface ActiveGrant {
  id: string;
  subtype: string;
  unionId: string | null;
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
      unionId: complianceGrants.unionId,
      scope: complianceGrants.scope,
      scopeId: complianceGrants.scopeId,
      createdAt: complianceGrants.createdAt,
    })
    .from(complianceGrants)
    .where(and(eq(complianceGrants.complianceUserId, userId), isNull(complianceGrants.revokedAt)))
    .all();
}

/**
 * The union ids a user watches — distinct unionIds of their active union-subtype
 * grants. With `platformOnly`, restricts to platform-scoped union grants, the gate
 * for managing a union's whole member roster.
 */
export async function getUnionIdsForUser(
  db: Db,
  userId: string,
  opts: { platformOnly?: boolean } = {},
): Promise<string[]> {
  const grants = await getActiveGrants(db, userId);
  const ids = new Set<string>();
  for (const g of grants) {
    if (g.subtype !== "union" || !g.unionId) continue;
    if (opts.platformOnly && g.scope !== "platform") continue;
    ids.add(g.unionId);
  }
  return [...ids];
}

/** Whether a compliance user holds an active platform-wide grant. */
export async function hasPlatformGrant(db: Db, userId: string): Promise<boolean> {
  const grants = await getActiveGrants(db, userId);
  return grants.some((g) => g.scope === "platform");
}

/**
 * Union ids the user watches via a union-*scope* grant (scope = "union"), i.e. the
 * unions whose affiliated talent + productions they may read. Distinct from
 * getUnionIdsForUser, which covers attribution across all union grants regardless
 * of scope.
 */
export async function getUnionScopeUnionIds(db: Db, userId: string): Promise<string[]> {
  const grants = await getActiveGrants(db, userId);
  const ids = new Set<string>();
  for (const g of grants) {
    if (g.scope === "union" && g.subtype === "union" && g.scopeId) ids.add(g.scopeId);
  }
  return [...ids];
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
 * A platform-wide grant authorises any scope; an exact scope + id grant matches
 * directly; and a union-scope grant authorises the talent, productions and
 * licences affiliated with that union (see lib/compliance/affiliation).
 */
export async function hasGrantForScope(
  db: Db,
  userId: string,
  scope: string,
  scopeId: string,
): Promise<boolean> {
  const grants = await getActiveGrants(db, userId);
  if (grants.some((g) => g.scope === "platform" || (g.scope === scope && g.scopeId === scopeId))) {
    return true;
  }

  // Union-scope grants extend visibility to the union's affiliated entities.
  const unionIds = [
    ...new Set(
      grants
        .filter((g) => g.scope === "union" && g.subtype === "union" && g.scopeId)
        .map((g) => g.scopeId as string),
    ),
  ];
  if (unionIds.length === 0) return false;

  if (scope === "talent") {
    return (await affiliatedTalentIds(db, unionIds)).has(scopeId);
  }
  if (scope === "production") {
    return (await affiliatedProductionIds(db, unionIds)).has(scopeId);
  }
  if (scope === "licence") {
    // A licence is in scope if its talent or its production is affiliated.
    const lic = await db
      .select({ talentId: licences.talentId, productionId: licences.productionId })
      .from(licences)
      .where(eq(licences.id, scopeId))
      .get();
    if (!lic) return false;
    if ((await affiliatedTalentIds(db, unionIds)).has(lic.talentId)) return true;
    if (lic.productionId && (await affiliatedProductionIds(db, unionIds)).has(lic.productionId)) return true;
  }
  return false;
}

/** Whether a compliance user holds any active insurer grant (i.e. is an insurer watcher). */
export async function hasInsurerGrant(db: Db, userId: string): Promise<boolean> {
  const grants = await getActiveGrants(db, userId);
  return grants.some((g) => g.subtype === "insurer");
}

/**
 * The production ids an insurer covers — distinct scopeIds of their active
 * production-scoped insurer grants, each with the grant id that authorises it.
 * This is the strict boundary for the insurer's portfolio: never platform-wide.
 */
export async function getInsurerProductionGrants(
  db: Db,
  userId: string,
): Promise<{ productionId: string; grantId: string }[]> {
  const grants = await getActiveGrants(db, userId);
  const seen = new Set<string>();
  const out: { productionId: string; grantId: string }[] = [];
  for (const g of grants) {
    if (g.subtype !== "insurer" || g.scope !== "production" || !g.scopeId) continue;
    if (seen.has(g.scopeId)) continue;
    seen.add(g.scopeId);
    out.push({ productionId: g.scopeId, grantId: g.id });
  }
  return out;
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
    unionId?: string | null;
  },
): Promise<string> {
  if (!isAllowedScopeForSubtype(params.subtype, params.scope)) {
    throw new GrantScopeError(
      `${params.subtype} grants are limited to scopes: ${
        params.subtype === "insurer" ? INSURER_ALLOWED_SCOPES.join(" | ") : COMPLIANCE_SCOPES.join(" | ")
      }`,
    );
  }

  // Every union watcher must be tied to one of the supported unions: a union grant
  // always carries a valid union_id, and no other subtype ever does.
  if (params.subtype !== "union" && params.unionId) {
    throw new GrantScopeError("union_id is only valid on union grants");
  }
  let unionId: string | null = null;
  if (params.subtype === "union") {
    if (!params.unionId) throw new GrantScopeError("union grants require a unionId");
    if (!getUnionPreset(params.unionId)) throw new GrantScopeError(`Unknown union: ${params.unionId}`);
    unionId = params.unionId;
  }

  // A union-scope grant's scope_id IS the union id, so it is derived from union_id
  // (which subtype "union" guarantees) rather than supplied separately.
  const scopeId =
    params.scope === "platform"
      ? null
      : params.scope === "union"
        ? unionId
        : params.scopeId;

  const existing = await db
    .select({ id: complianceGrants.id })
    .from(complianceGrants)
    .where(
      and(
        eq(complianceGrants.complianceUserId, params.complianceUserId),
        eq(complianceGrants.subtype, params.subtype),
        unionId === null ? isNull(complianceGrants.unionId) : eq(complianceGrants.unionId, unionId),
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
    unionId,
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
