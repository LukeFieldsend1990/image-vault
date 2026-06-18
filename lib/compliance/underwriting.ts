// Insurer underwriting view (Phase 8 §4.2). Reframes the existing per-production
// compliance signals — health score, cast onboarding, coverage gaps, use-before-
// consent violations, active strikes — as an underwriting grade (A–D) for one
// production, and layers the insurer's own policy metadata on top to surface the
// highest-value flags: a lapsed policy, and likeness usage recorded OUTSIDE the
// policy window (uninsured use).
//
// Everything composes the already-trusted builders (buildProductionsOverview,
// detectUseViolationsForLicences) so the numbers tie out with the union/regulator
// surfaces. Nothing here reaches the data plane — it reads the same evidence the
// compliance role already exposes, scoped strictly to the insurer's granted
// productions.

import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  insurerPolicies,
  licences,
  organisations,
  productionCast,
  productions,
  strikeLocks,
} from "@/lib/db/schema";
import {
  buildProductionsOverview,
  isActiveStatus,
  type CastSummary,
} from "./productions";
import { detectUseViolationsForLicences } from "./violations";
import type { RegimeId } from "./types";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export type UnderwritingGrade = "A" | "B" | "C" | "D";
export type PolicyLine = "eo" | "cyber" | "completion_bond" | "other";

export const POLICY_LINES: readonly PolicyLine[] = ["eo", "cyber", "completion_bond", "other"];

export interface PolicySummary {
  id: string;
  policyNumber: string | null;
  policyLine: PolicyLine;
  coverageLimit: number | null;
  currency: string;
  effectiveFrom: number | null;
  effectiveTo: number | null;
  notes: string | null;
  createdAt: number;
  lapsed: boolean; // policy window has ended
}

export interface UnderwritingView {
  production: {
    id: string;
    name: string;
    type: string | null;
    status: string | null;
    active: boolean;
    year: number | null;
    orgName: string | null;
  };
  grade: UnderwritingGrade;
  healthScore: number;
  cast: CastSummary;
  licenceCount: number;
  coverageGaps: number; // live licences with no recorded 39.B consent
  useViolations: number; // provable use before/without consent
  usedWithoutConsent: number;
  usedBeforeConsent: number;
  activeStrikes: number;
  policies: PolicySummary[];
  // Highest-value insurer flags:
  uninsuredUse: boolean; // likeness used outside any policy window (or with no policy on record)
  firstUseAt: number | null;
  lastUseAt: number | null;
}

/**
 * Underwriting grade. Hard breaches (likeness used before/without consent) or a
 * live strike are the exposures that actually generate claims, so they cap the
 * grade regardless of an otherwise-healthy paperwork score. Otherwise grade tracks
 * the existing 0–100 compliance health.
 */
export function gradeFor(input: {
  healthScore: number;
  useViolations: number;
  activeStrikes: number;
}): UnderwritingGrade {
  if (input.useViolations > 1) return "D";
  if (input.useViolations === 1 || input.activeStrikes > 0) return "C";
  if (input.healthScore >= 85) return "A";
  if (input.healthScore >= 70) return "B";
  if (input.healthScore >= 55) return "C";
  return "D";
}

export const GRADE_LABEL: Record<UnderwritingGrade, string> = {
  A: "Low risk",
  B: "Acceptable",
  C: "Elevated risk",
  D: "High risk",
};

/** Count active strikes scoped directly to this production. */
async function countProductionStrikes(db: Db, productionId: string): Promise<number> {
  const rows = await db
    .select({ id: strikeLocks.id })
    .from(strikeLocks)
    .where(
      and(
        eq(strikeLocks.status, "active"),
        eq(strikeLocks.scope, "production"),
        eq(strikeLocks.scopeId, productionId),
      ),
    )
    .all();
  return rows.length;
}

/**
 * The provable likeness-use timestamps for a production: the earliest use across
 * all its licences and the latest known use (download). Used to decide whether the
 * usage falls inside an active policy window.
 */
async function productionUseWindow(
  db: Db,
  productionId: string,
): Promise<{ firstUseAt: number | null; lastUseAt: number | null }> {
  const licRows = await db
    .select({ id: licences.id, lastDownloadAt: licences.lastDownloadAt })
    .from(licences)
    .where(eq(licences.productionId, productionId))
    .all();
  if (licRows.length === 0) return { firstUseAt: null, lastUseAt: null };

  const violations = await detectUseViolationsForLicences(db, licRows);
  const uses: number[] = [];
  for (const l of licRows) {
    const v = violations.get(l.id);
    if (v?.firstUseAt != null) uses.push(v.firstUseAt);
    if (l.lastDownloadAt != null) uses.push(l.lastDownloadAt);
  }
  if (uses.length === 0) return { firstUseAt: null, lastUseAt: null };
  return { firstUseAt: Math.min(...uses), lastUseAt: Math.max(...uses) };
}

function summarisePolicy(row: typeof insurerPolicies.$inferSelect, now: number): PolicySummary {
  return {
    id: row.id,
    policyNumber: row.policyNumber,
    policyLine: row.policyLine as PolicyLine,
    coverageLimit: row.coverageLimit,
    currency: row.currency ?? "USD",
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    notes: row.notes,
    createdAt: row.createdAt,
    lapsed: row.effectiveTo != null && row.effectiveTo < now,
  };
}

/** Whether a policy's window covers the whole [firstUse, lastUse] span of usage. */
function policyCoversUse(
  p: PolicySummary,
  firstUseAt: number | null,
  lastUseAt: number | null,
): boolean {
  if (firstUseAt == null) return true; // no use → nothing to cover
  if (p.effectiveFrom != null && p.effectiveFrom > firstUseAt) return false;
  if (p.effectiveTo != null && lastUseAt != null && p.effectiveTo < lastUseAt) return false;
  return true;
}

/** Active (non-archived) policies for a production, summarised. */
export async function listPolicies(db: Db, productionId: string): Promise<PolicySummary[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .select()
    .from(insurerPolicies)
    .where(and(eq(insurerPolicies.productionId, productionId), isNull(insurerPolicies.archivedAt)))
    .all();
  return rows.map((r) => summarisePolicy(r, now));
}

const EMPTY_CAST: CastSummary = {
  total: 0, consented: 0, linked: 0, invited: 0, placeholder: 0, declined: 0, sagMembers: 0,
};

/** Cast onboarding counts for a production straight from productionCast. */
async function castSummaryForProduction(db: Db, productionId: string): Promise<CastSummary> {
  const rows = await db
    .select({ status: productionCast.status, sagMember: productionCast.sagMember })
    .from(productionCast)
    .where(eq(productionCast.productionId, productionId))
    .all();
  const c: CastSummary = { ...EMPTY_CAST };
  for (const r of rows) {
    c.total++;
    if (r.sagMember) c.sagMembers++;
    switch (r.status) {
      case "consented": c.consented++; break;
      case "linked":
      case "scan_uploaded": c.linked++; break;
      case "invited": c.invited++; break;
      case "placeholder": c.placeholder++; break;
      case "declined": c.declined++; break;
    }
  }
  return c;
}

/**
 * Build the underwriting view for one production. Reuses the platform productions
 * overview for health/gaps/violations/cast so the figures match the rest of the
 * compliance surface; falls back to a minimal view for a production that has no
 * licensed exposure yet (so it isn't on the overview). Returns null if no such
 * production exists.
 */
export async function buildUnderwritingView(
  db: Db,
  productionId: string,
  regime: RegimeId,
): Promise<UnderwritingView | null> {
  const overview = await buildProductionsOverview(db, regime);
  const row = overview.find((p) => p.id === productionId);

  const [activeStrikes, useWindow, policies] = await Promise.all([
    countProductionStrikes(db, productionId),
    productionUseWindow(db, productionId),
    listPolicies(db, productionId),
  ]);

  let base: {
    production: UnderwritingView["production"];
    healthScore: number;
    cast: CastSummary;
    licenceCount: number;
    coverageGaps: number;
    useViolations: number;
    usedWithoutConsent: number;
    usedBeforeConsent: number;
  };

  if (row) {
    // Split the production's use violations into the two kinds for the panel.
    const licRows = await db
      .select({ id: licences.id, lastDownloadAt: licences.lastDownloadAt })
      .from(licences)
      .where(eq(licences.productionId, productionId))
      .all();
    const v = await detectUseViolationsForLicences(db, licRows);
    let usedWithoutConsent = 0, usedBeforeConsent = 0;
    for (const l of licRows) {
      const kind = v.get(l.id)?.kind;
      if (kind === "used_without_consent") usedWithoutConsent++;
      else if (kind === "used_before_consent") usedBeforeConsent++;
    }
    base = {
      production: {
        id: row.id,
        name: row.name,
        type: row.type,
        status: row.status,
        active: row.active,
        year: row.year,
        orgName: row.orgName,
      },
      healthScore: row.healthScore,
      cast: row.cast,
      licenceCount: row.licenceCount,
      coverageGaps: row.coverageGaps,
      useViolations: row.useViolations,
      usedWithoutConsent,
      usedBeforeConsent,
    };
  } else {
    // No licensed exposure yet — load the production directly so an insurer added
    // pre-production still gets a (clean) dashboard rather than a 404.
    const meta = await db
      .select({
        id: productions.id,
        name: productions.name,
        type: productions.type,
        status: productions.status,
        year: productions.year,
        orgName: organisations.name,
      })
      .from(productions)
      .leftJoin(organisations, eq(productions.organisationId, organisations.id))
      .where(eq(productions.id, productionId))
      .get();
    if (!meta) return null;
    const cast = await castSummaryForProduction(db, productionId);
    base = {
      production: {
        id: meta.id,
        name: meta.name,
        type: meta.type,
        status: meta.status,
        active: isActiveStatus(meta.status),
        year: meta.year,
        orgName: meta.orgName ?? null,
      },
      healthScore: 100,
      cast,
      licenceCount: 0,
      coverageGaps: 0,
      useViolations: 0,
      usedWithoutConsent: 0,
      usedBeforeConsent: 0,
    };
  }

  const grade = gradeFor({
    healthScore: base.healthScore,
    useViolations: base.useViolations,
    activeStrikes,
  });

  // Uninsured use: the likeness was used but no live policy window covers the full
  // usage span (or there's use with no policy on record at all).
  const activePolicies = policies.filter((p) => !p.lapsed);
  const uninsuredUse =
    useWindow.firstUseAt != null &&
    !activePolicies.some((p) => policyCoversUse(p, useWindow.firstUseAt, useWindow.lastUseAt));

  return {
    production: base.production,
    grade,
    healthScore: base.healthScore,
    cast: base.cast,
    licenceCount: base.licenceCount,
    coverageGaps: base.coverageGaps,
    useViolations: base.useViolations,
    usedWithoutConsent: base.usedWithoutConsent,
    usedBeforeConsent: base.usedBeforeConsent,
    activeStrikes,
    policies,
    uninsuredUse,
    firstUseAt: useWindow.firstUseAt,
    lastUseAt: useWindow.lastUseAt,
  };
}

export interface PortfolioRow {
  productionId: string;
  name: string;
  type: string | null;
  status: string | null;
  active: boolean;
  orgName: string | null;
  grade: UnderwritingGrade;
  healthScore: number;
  coverageGaps: number;
  useViolations: number;
  castTotal: number;
  castConsented: number;
  policyCount: number;
  hasLapsedPolicy: boolean;
  uninsuredUse: boolean;
}

/**
 * Portfolio roll-up: one row per production the insurer covers (§4.4, light).
 * Strictly scoped to the supplied production ids — the caller resolves these from
 * the insurer's active grants, never platform-wide. Reuses the single overview
 * pass for headline metrics and layers per-production strike/policy/use flags.
 */
export async function buildPortfolio(
  db: Db,
  productionIds: string[],
  regime: RegimeId,
): Promise<PortfolioRow[]> {
  if (productionIds.length === 0) return [];
  const idSet = new Set(productionIds);
  const overview = await buildProductionsOverview(db, regime);
  const byId = new Map(overview.filter((p) => idSet.has(p.id)).map((p) => [p.id, p]));

  // Per-production strikes (one query), and policies (one query), then assemble.
  const [strikeRows, policyRows, useWindows] = await Promise.all([
    db
      .select({ scopeId: strikeLocks.scopeId })
      .from(strikeLocks)
      .where(
        and(
          eq(strikeLocks.status, "active"),
          eq(strikeLocks.scope, "production"),
          inArray(strikeLocks.scopeId, productionIds),
        ),
      )
      .all(),
    db
      .select()
      .from(insurerPolicies)
      .where(and(inArray(insurerPolicies.productionId, productionIds), isNull(insurerPolicies.archivedAt)))
      .all(),
    Promise.all(productionIds.map(async (id) => [id, await productionUseWindow(db, id)] as const)),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const strikesByProd = new Map<string, number>();
  for (const s of strikeRows) {
    if (s.scopeId) strikesByProd.set(s.scopeId, (strikesByProd.get(s.scopeId) ?? 0) + 1);
  }
  const policiesByProd = new Map<string, PolicySummary[]>();
  for (const r of policyRows) {
    const list = policiesByProd.get(r.productionId) ?? [];
    list.push(summarisePolicy(r, now));
    policiesByProd.set(r.productionId, list);
  }
  const useByProd = new Map(useWindows.map(([id, w]) => [id, w]));

  // Build a row for every covered production, even those absent from the overview
  // (no licensed exposure yet) — load their meta in one batch.
  const missing = productionIds.filter((id) => !byId.has(id));
  const metaById = new Map<string, { name: string; type: string | null; status: string | null; orgName: string | null }>();
  if (missing.length) {
    const metas = await db
      .select({
        id: productions.id,
        name: productions.name,
        type: productions.type,
        status: productions.status,
        orgName: organisations.name,
      })
      .from(productions)
      .leftJoin(organisations, eq(productions.organisationId, organisations.id))
      .where(inArray(productions.id, missing))
      .all();
    for (const m of metas) metaById.set(m.id, { name: m.name, type: m.type, status: m.status, orgName: m.orgName ?? null });
  }

  const rows: PortfolioRow[] = [];
  for (const id of productionIds) {
    const o = byId.get(id);
    const strikes = strikesByProd.get(id) ?? 0;
    const policies = policiesByProd.get(id) ?? [];
    const activePolicies = policies.filter((p) => !p.lapsed);
    const w = useByProd.get(id) ?? { firstUseAt: null, lastUseAt: null };
    const uninsuredUse =
      w.firstUseAt != null && !activePolicies.some((p) => policyCoversUse(p, w.firstUseAt, w.lastUseAt));

    if (o) {
      rows.push({
        productionId: id,
        name: o.name,
        type: o.type,
        status: o.status,
        active: o.active,
        orgName: o.orgName,
        grade: gradeFor({ healthScore: o.healthScore, useViolations: o.useViolations, activeStrikes: strikes }),
        healthScore: o.healthScore,
        coverageGaps: o.coverageGaps,
        useViolations: o.useViolations,
        castTotal: o.cast.total,
        castConsented: o.cast.consented,
        policyCount: policies.length,
        hasLapsedPolicy: policies.some((p) => p.lapsed),
        uninsuredUse,
      });
    } else {
      const meta = metaById.get(id);
      if (!meta) continue;
      rows.push({
        productionId: id,
        name: meta.name,
        type: meta.type,
        status: meta.status,
        active: isActiveStatus(meta.status),
        orgName: meta.orgName,
        grade: gradeFor({ healthScore: 100, useViolations: 0, activeStrikes: strikes }),
        healthScore: 100,
        coverageGaps: 0,
        useViolations: 0,
        castTotal: 0,
        castConsented: 0,
        policyCount: policies.length,
        hasLapsedPolicy: policies.some((p) => p.lapsed),
        uninsuredUse,
      });
    }
  }

  // Worst risk first: lowest grade, then most violations, then most gaps.
  const gradeRank: Record<UnderwritingGrade, number> = { D: 0, C: 1, B: 2, A: 3 };
  rows.sort((a, b) => {
    if (gradeRank[a.grade] !== gradeRank[b.grade]) return gradeRank[a.grade] - gradeRank[b.grade];
    if (a.useViolations !== b.useViolations) return b.useViolations - a.useViolations;
    return b.coverageGaps - a.coverageGaps;
  });

  return rows;
}
