// Repeat-offender scorecard — ranks production companies by their accumulated
// SAG-AFTRA compliance breaches so the union can see, at a glance, which companies
// reoffend across productions rather than slipping by one licence at a time.
//
// It composes existing, already-trusted signals so the numbers always tie out with
// the rest of the compliance surface:
//   • per-production coverage gaps + health      ← buildProductionsOverview
//   • consent-before-use breaches (with split)   ← detectUseViolationsForLicences
//   • active strike locks                        ← strike_locks (org/production/licence scope)
//
// "Repeat offender" is the load-bearing concept: a single slip is a gap; the same
// company breaching across MORE THAN ONE production is the pattern the union acts on.

import { eq, inArray } from "drizzle-orm";
import { licences, organisations, productions, strikeLocks } from "@/lib/db/schema";
import { buildProductionsOverview } from "./productions";
import { detectUseViolationsForLicences } from "./violations";
import type { RegimeId } from "./types";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

// Productions with no owning organisation are grouped under this synthetic bucket so
// their breaches are never hidden — but it is not treated as a "company".
const INDEPENDENT_ID = "__independent__";
const INDEPENDENT_NAME = "Independent / no company";

// Offender-score weights. Used-without-consent is the gravest (likeness exploited
// with nothing on record); a strike is a live freeze; before-consent is a proven
// temporal breach; a coverage gap is the lightest (missing paperwork on a live licence).
const WEIGHT = { usedWithoutConsent: 5, usedBeforeConsent: 4, activeStrike: 3, coverageGap: 2 } as const;

export interface OffenderScorecardRow {
  orgId: string | null;
  orgName: string;
  isCompany: boolean;            // false for the synthetic independent bucket
  productionCount: number;
  productionsWithViolations: number;
  licenceCount: number;
  coverageGaps: number;          // current-state: live licence, no recorded 39.B consent
  usedWithoutConsent: number;    // proven use, no consent ever recorded
  usedBeforeConsent: number;     // proven use predating consent
  useViolations: number;         // usedWithoutConsent + usedBeforeConsent
  activeStrikes: number;
  avgHealthScore: number;
  worstHealthScore: number;
  offenderScore: number;
  repeatOffender: boolean;       // breaches span more than one production
}

interface Agg {
  orgId: string | null;
  orgName: string;
  isCompany: boolean;
  productionCount: number;
  productionsWithViolations: number;
  licenceCount: number;
  coverageGaps: number;
  usedWithoutConsent: number;
  usedBeforeConsent: number;
  activeStrikes: number;
  healthScores: number[];
}

function emptyAgg(orgId: string | null, orgName: string, isCompany: boolean): Agg {
  return {
    orgId, orgName, isCompany,
    productionCount: 0, productionsWithViolations: 0, licenceCount: 0,
    coverageGaps: 0, usedWithoutConsent: 0, usedBeforeConsent: 0,
    activeStrikes: 0, healthScores: [],
  };
}

/** Platform-wide repeat-offender scorecard, one row per production company. */
export async function buildOffenderScorecard(db: Db, regime: RegimeId): Promise<OffenderScorecardRow[]> {
  // Reuse the productions tracker so coverage gaps, health and production counts are
  // identical to what the union sees on the Productions surface.
  const overview = await buildProductionsOverview(db, regime);

  const aggs = new Map<string, Agg>();
  const keyFor = (orgId: string | null) => orgId ?? INDEPENDENT_ID;
  const ensure = (orgId: string | null, orgName: string | null) => {
    const key = keyFor(orgId);
    let a = aggs.get(key);
    if (!a) {
      a = orgId
        ? emptyAgg(orgId, orgName ?? "Unnamed company", true)
        : emptyAgg(null, INDEPENDENT_NAME, false);
      aggs.set(key, a);
    }
    return a;
  };

  for (const p of overview) {
    const a = ensure(p.orgId, p.orgName);
    a.productionCount++;
    if (p.useViolations > 0) a.productionsWithViolations++;
    a.coverageGaps += p.coverageGaps;
    a.healthScores.push(p.healthScore);
  }

  // Licence-level consent-before-use split + per-org licence counts. Driven straight
  // off the licences table so it covers org licences even if they predate a
  // production record.
  const licenceRows = await db
    .select({
      id: licences.id,
      organisationId: licences.organisationId,
      productionId: licences.productionId,
      lastDownloadAt: licences.lastDownloadAt,
    })
    .from(licences)
    .all();

  if (licenceRows.length) {
    const orgNames = new Map<string, string>();
    const orgRows = await db.select({ id: organisations.id, name: organisations.name }).from(organisations).all();
    for (const o of orgRows) orgNames.set(o.id, o.name);

    const violations = await detectUseViolationsForLicences(db, licenceRows);
    for (const l of licenceRows) {
      const a = ensure(l.organisationId, l.organisationId ? orgNames.get(l.organisationId) ?? null : null);
      a.licenceCount++;
      const kind = violations.get(l.id)?.kind;
      if (kind === "used_without_consent") a.usedWithoutConsent++;
      else if (kind === "used_before_consent") a.usedBeforeConsent++;
    }
  }

  // Active strike locks, attributed to the owning org. Org-scoped strikes map
  // directly; production- and licence-scoped strikes resolve through their owner.
  await attributeStrikes(db, aggs, keyFor);

  const rows: OffenderScorecardRow[] = [...aggs.values()].map((a) => {
    const useViolations = a.usedWithoutConsent + a.usedBeforeConsent;
    const offenderScore =
      a.usedWithoutConsent * WEIGHT.usedWithoutConsent +
      a.usedBeforeConsent * WEIGHT.usedBeforeConsent +
      a.activeStrikes * WEIGHT.activeStrike +
      a.coverageGaps * WEIGHT.coverageGap;
    const avgHealthScore = a.healthScores.length
      ? Math.round(a.healthScores.reduce((s, v) => s + v, 0) / a.healthScores.length)
      : 100;
    const worstHealthScore = a.healthScores.length ? Math.min(...a.healthScores) : 100;
    return {
      orgId: a.orgId,
      orgName: a.orgName,
      isCompany: a.isCompany,
      productionCount: a.productionCount,
      productionsWithViolations: a.productionsWithViolations,
      licenceCount: a.licenceCount,
      coverageGaps: a.coverageGaps,
      usedWithoutConsent: a.usedWithoutConsent,
      usedBeforeConsent: a.usedBeforeConsent,
      useViolations,
      activeStrikes: a.activeStrikes,
      avgHealthScore,
      worstHealthScore,
      offenderScore,
      repeatOffender: a.productionsWithViolations > 1,
    };
  });

  // Worst offenders first; ties broken by repeat-offender status then breach volume.
  rows.sort((a, b) => {
    if (a.offenderScore !== b.offenderScore) return b.offenderScore - a.offenderScore;
    if (a.repeatOffender !== b.repeatOffender) return a.repeatOffender ? -1 : 1;
    return b.useViolations - a.useViolations;
  });

  return rows;
}

// Resolve every active strike to an owning org bucket and increment its count.
async function attributeStrikes(
  db: Db,
  aggs: Map<string, Agg>,
  keyFor: (orgId: string | null) => string,
): Promise<void> {
  const strikes = await db
    .select({ scope: strikeLocks.scope, scopeId: strikeLocks.scopeId })
    .from(strikeLocks)
    .where(eq(strikeLocks.status, "active"))
    .all();
  if (strikes.length === 0) return;

  const bump = (orgId: string | null) => {
    const a = aggs.get(keyFor(orgId));
    if (a) a.activeStrikes++;
    // Strikes against an org/production/licence with no scorecard row (e.g. no
    // licences yet) are intentionally dropped — the scorecard ranks companies that
    // appear elsewhere on the compliance surface.
  };

  const productionScoped = strikes.filter((s) => s.scope === "production" && s.scopeId).map((s) => s.scopeId!);
  const licenceScoped = strikes.filter((s) => s.scope === "licence" && s.scopeId).map((s) => s.scopeId!);

  const prodToOrg = new Map<string, string | null>();
  if (productionScoped.length) {
    const rows = await db
      .select({ id: productions.id, organisationId: productions.organisationId })
      .from(productions)
      .where(inArray(productions.id, productionScoped))
      .all();
    for (const r of rows) prodToOrg.set(r.id, r.organisationId);
  }
  const licToOrg = new Map<string, string | null>();
  if (licenceScoped.length) {
    const rows = await db
      .select({ id: licences.id, organisationId: licences.organisationId })
      .from(licences)
      .where(inArray(licences.id, licenceScoped))
      .all();
    for (const r of rows) licToOrg.set(r.id, r.organisationId);
  }

  for (const s of strikes) {
    if (s.scope === "organisation" && s.scopeId) bump(s.scopeId);
    else if (s.scope === "production" && s.scopeId && prodToOrg.has(s.scopeId)) bump(prodToOrg.get(s.scopeId)!);
    else if (s.scope === "licence" && s.scopeId && licToOrg.has(s.scopeId)) bump(licToOrg.get(s.scopeId)!);
    // global strikes are platform-wide, not attributable to one company → skipped
  }
}
