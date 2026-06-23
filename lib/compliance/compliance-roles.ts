// Admin compliance-roles overview (SPEC §16 — compliance roles console).
//
// One aggregate the /admin/compliance-roles hub renders: the two first-party
// union presets (with their regime obligations + flagged-production counts), the
// insurer grants enriched with their recorded policies, and the full active-grant
// roster grouped by subtype. Everything reads the existing compliance tables —
// nothing new is stored. Union watcher grants carry subtype "union" generically
// (they are not attributable to SAG vs Equity), so per-union figures come from the
// union-specific signals — the regime and the production flag — while the watcher
// roster is surfaced at the section level.

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  complianceGrants,
  insurerPolicies,
  organisations,
  productions,
  talentProfiles,
  users,
} from "@/lib/db/schema";
import { getRegime, listObligations } from "./registry";
import { isActiveStatus } from "./productions";
import { rosterCoverageByUnion } from "./members";
import { UNION_PRESETS, getUnionPreset } from "./unions";
import "./regimes"; // side-effect: populate the regime registry before we read it
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface UnionSummary {
  id: string;
  shortName: string;
  name: string;
  jurisdiction: string;
  regimeId: string;
  regimeName: string | null;
  description: string;
  obligationCount: number;
  requiredCount: number;
  productionCount: number;
  activeProductionCount: number;
  watcherCount: number; // active union grants attributed to this union
  rosterTotal: number;
  rosterOnPlatform: number;
  rosterCoveragePct: number;
}

export interface WatcherGrant {
  id: string;
  complianceUserId: string;
  email: string | null;
  subtype: string;
  unionId: string | null;
  unionShortName: string | null;
  scope: string;
  scopeId: string | null;
  scopeLabel: string | null;
  createdAt: number;
}

export interface InsurerSummary {
  grantId: string;
  complianceUserId: string;
  email: string | null;
  productionId: string | null;
  productionName: string | null;
  createdAt: number;
  policyCount: number;
  coverageTotal: number; // sum of policy coverage limits (see `currencies` for mix)
  currencies: string[];
  hasLapsedPolicy: boolean;
}

export interface ComplianceRolesOverview {
  unions: UnionSummary[];
  watchers: WatcherGrant[];
  insurers: InsurerSummary[];
  counts: { union: number; regulator: number; insurer: number; total: number };
}

export async function buildComplianceRolesOverview(db: Db): Promise<ComplianceRolesOverview> {
  // 1. Active grants with the watcher's email.
  const watcher = alias(users, "watcher");
  const grants = await db
    .select({
      id: complianceGrants.id,
      complianceUserId: complianceGrants.complianceUserId,
      email: watcher.email,
      subtype: complianceGrants.subtype,
      unionId: complianceGrants.unionId,
      scope: complianceGrants.scope,
      scopeId: complianceGrants.scopeId,
      createdAt: complianceGrants.createdAt,
    })
    .from(complianceGrants)
    .leftJoin(watcher, eq(watcher.id, complianceGrants.complianceUserId))
    .where(isNull(complianceGrants.revokedAt))
    .orderBy(desc(complianceGrants.createdAt))
    .all();

  // 2. Resolve human-readable labels for scoped grants.
  const prodIds = new Set<string>();
  const orgIds = new Set<string>();
  const talentIds = new Set<string>();
  for (const g of grants) {
    if (!g.scopeId) continue;
    if (g.scope === "production") prodIds.add(g.scopeId);
    else if (g.scope === "organisation") orgIds.add(g.scopeId);
    else if (g.scope === "talent") talentIds.add(g.scopeId);
  }

  const [prodRows, orgRows, talentRows] = await Promise.all([
    prodIds.size
      ? db.select({ id: productions.id, name: productions.name }).from(productions).where(inArray(productions.id, [...prodIds])).all()
      : Promise.resolve([] as { id: string; name: string }[]),
    orgIds.size
      ? db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(inArray(organisations.id, [...orgIds])).all()
      : Promise.resolve([] as { id: string; name: string }[]),
    talentIds.size
      ? db.select({ id: talentProfiles.userId, name: talentProfiles.fullName }).from(talentProfiles).where(inArray(talentProfiles.userId, [...talentIds])).all()
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const prodName = new Map(prodRows.map((r) => [r.id, r.name]));
  const orgName = new Map(orgRows.map((r) => [r.id, r.name]));
  const talentName = new Map(talentRows.map((r) => [r.id, r.name]));

  function labelFor(scope: string, scopeId: string | null): string | null {
    if (scope === "platform") return "Platform-wide";
    if (!scopeId) return null;
    if (scope === "union") return getUnionPreset(scopeId)?.shortName ?? scopeId;
    if (scope === "production") return prodName.get(scopeId) ?? null;
    if (scope === "organisation") return orgName.get(scopeId) ?? null;
    if (scope === "talent") return talentName.get(scopeId) ?? null;
    return null;
  }

  const watchers: WatcherGrant[] = grants.map((g) => ({
    ...g,
    unionShortName: g.unionId ? getUnionPreset(g.unionId)?.shortName ?? g.unionId : null,
    scopeLabel: labelFor(g.scope, g.scopeId),
  }));

  // 3. Union summaries from the regime + production flags (union-specific signals),
  // plus per-union watcher counts and roster coverage.
  const prodFlags = await db
    .select({ isSag: productions.isSag, isEquity: productions.isEquity, status: productions.status })
    .from(productions)
    .all();
  const coverage = await rosterCoverageByUnion(db);
  const watcherCountByUnion = new Map<string, number>();
  for (const g of grants) {
    if (g.subtype === "union" && g.unionId) {
      watcherCountByUnion.set(g.unionId, (watcherCountByUnion.get(g.unionId) ?? 0) + 1);
    }
  }

  const unions: UnionSummary[] = UNION_PRESETS.map((u) => {
    const obligations = listObligations(u.regimeId);
    const regime = getRegime(u.regimeId);
    let productionCount = 0;
    let activeProductionCount = 0;
    for (const p of prodFlags) {
      const flagged = u.productionFlag === "isSag" ? p.isSag : p.isEquity;
      if (!flagged) continue;
      productionCount++;
      if (isActiveStatus(p.status)) activeProductionCount++;
    }
    const cov = coverage[u.id];
    return {
      id: u.id,
      shortName: u.shortName,
      name: u.name,
      jurisdiction: u.jurisdiction,
      regimeId: u.regimeId,
      regimeName: regime?.name ?? null,
      description: u.description,
      obligationCount: obligations.length,
      requiredCount: obligations.filter((o) => o.severity === "required").length,
      productionCount,
      activeProductionCount,
      watcherCount: watcherCountByUnion.get(u.id) ?? 0,
      rosterTotal: cov?.total ?? 0,
      rosterOnPlatform: cov?.onPlatform ?? 0,
      rosterCoveragePct: cov?.coveragePct ?? 0,
    };
  });

  // 4. Insurer grants enriched with their recorded policies.
  const insurerGrants = grants.filter((g) => g.subtype === "insurer");
  const grantIds = insurerGrants.map((g) => g.id);
  const now = Math.floor(Date.now() / 1000);
  const policyRows = grantIds.length
    ? await db
        .select()
        .from(insurerPolicies)
        .where(and(inArray(insurerPolicies.grantId, grantIds), isNull(insurerPolicies.archivedAt)))
        .all()
    : [];
  const policiesByGrant = new Map<string, typeof policyRows>();
  for (const p of policyRows) {
    const list = policiesByGrant.get(p.grantId) ?? [];
    list.push(p);
    policiesByGrant.set(p.grantId, list);
  }

  const insurers: InsurerSummary[] = insurerGrants.map((g) => {
    const ps = policiesByGrant.get(g.id) ?? [];
    const currencies = [...new Set(ps.map((p) => p.currency ?? "USD"))];
    const coverageTotal = ps.reduce((sum, p) => sum + (p.coverageLimit ?? 0), 0);
    return {
      grantId: g.id,
      complianceUserId: g.complianceUserId,
      email: g.email,
      productionId: g.scope === "production" ? g.scopeId : null,
      productionName: g.scope === "production" && g.scopeId ? prodName.get(g.scopeId) ?? null : null,
      createdAt: g.createdAt,
      policyCount: ps.length,
      coverageTotal,
      currencies,
      hasLapsedPolicy: ps.some((p) => p.effectiveTo != null && p.effectiveTo < now),
    };
  });

  const counts = {
    union: grants.filter((g) => g.subtype === "union").length,
    regulator: grants.filter((g) => g.subtype === "regulator").length,
    insurer: insurerGrants.length,
    total: grants.length,
  };

  return { unions, watchers, insurers, counts };
}
