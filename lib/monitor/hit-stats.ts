/**
 * Deepfake hit statistics over a cohort of talent.
 *
 * Two surfaces consume this: a union watcher looking at the members affiliated
 * with their union, and a rep looking at their roster. Both ask the same four
 * questions — how many lifetime, how many this month, is it getting worse, and
 * which people are carrying it — so both get the same shape from one module.
 *
 * Scope note: this is a *counting* layer over `likeness_hits`, never a content
 * layer. It returns numbers, month buckets and per-person totals; it never
 * returns a content URL, caption, thumbnail, handle or rationale. That matters
 * for the union surface, which is read-only compliance visibility and must not
 * become a second route into the data plane — a union sees that a member has
 * eleven hits, never what the eleven hits are. Reps get the detail they are
 * already entitled to on /roster/monitor, not here.
 *
 * The SQL side aggregates in the database (conditional sums grouped by talent,
 * plus three small cohort-wide rollups) so result sets stay bounded by the
 * cohort size and 13 month buckets rather than by the hit count. The assembly
 * and every derived rate live in pure functions below, which is where the
 * awkward cases — a month-to-date compared against a longer previous month, a
 * growth rate against a zero baseline — are pinned down by tests.
 */

import { and, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { likenessHits } from "@/lib/db/schema";
import { platformName } from "./platforms";

type Db = ReturnType<typeof getDb>;

// D1 caps bound parameters per statement; chunk inArray lists well under it.
const CHUNK = 80;

/** Months of history in the trend series (12 complete + the current one). */
const SERIES_MONTHS = 13;

/** "Open" for every consumer of this module — a hit still needing someone.
 *  The SQL below builds its predicate from this list, so the two cannot drift. */
const OPEN_STATUSES = ["new", "confirmed", "takedown_requested"] as const;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CohortMember {
  talentId: string;
  name: string;
}

/** Per-talent conditional sums, straight out of SQL. */
export interface TalentHitAggregate {
  talentId: string;
  total: number;
  open: number;
  confirmed: number;
  takedownRequested: number;
  resolved: number;
  dismissed: number;
  highRisk: number;
  thisMonth: number;
  /** Previous month truncated to the same elapsed point — the like-for-like baseline. */
  prevMonthToDate: number;
  prevMonthFull: number;
  last30d: number;
  prev30d: number;
  latestAt: number | null;
}

export interface MemberHitStats extends TalentHitAggregate {
  name: string;
}

export interface MonthBucket {
  /** "YYYY-MM" (UTC). */
  month: string;
  /** Short display label, e.g. "Mar 26". */
  label: string;
  hits: number;
}

export interface BreakdownSlice {
  key: string;
  label: string;
  hits: number;
  /** Percentage of the cohort's lifetime hits, rounded to a whole number. */
  share: number;
}

export interface GrowthReading {
  current: number;
  previous: number;
  /** Percentage change, one decimal. Null when `previous` is 0 — a rate against
   *  nothing is not a growth rate, and rendering it as "+∞%" or "+100%" lies. */
  pct: number | null;
  direction: "up" | "down" | "flat";
}

export interface DeepfakeHitStats {
  generatedAt: number;
  cohort: {
    /** Talent in scope (union-affiliated members, or the rep's roster). */
    size: number;
    /** Of those, how many have ever had a hit. */
    withHits: number;
    /** Of those, how many have an open hit right now. */
    withOpenHits: number;
  };
  lifetime: {
    total: number;
    open: number;
    confirmed: number;
    takedownRequested: number;
    resolved: number;
    dismissed: number;
    highRisk: number;
    firstDetectedAt: number | null;
    latestAt: number | null;
  };
  thisMonth: {
    /** "YYYY-MM" (UTC) of the month in progress. */
    month: string;
    label: string;
    hits: number;
    /** Days elapsed in the month so far, inclusive of today. */
    daysElapsed: number;
    /** Hits per day so far, one decimal. */
    perDay: number;
    /** Straight-line month-end projection at the current pace. */
    projected: number;
  };
  growth: {
    /** Month-to-date against the same elapsed slice of last month. */
    monthOnMonth: GrowthReading;
    /** Last complete month against the one before it. */
    completedMonths: GrowthReading;
    /** Rolling 30 days against the 30 before that. */
    rolling30d: GrowthReading;
  };
  months: MonthBucket[];
  byPlatform: BreakdownSlice[];
  byRisk: BreakdownSlice[];
  /** Per-member totals, worst first. Counts only — never hit content. */
  members: MemberHitStats[];
}

// ── Time windows ─────────────────────────────────────────────────────────────

export interface HitStatWindows {
  now: number;
  monthStart: number;
  prevMonthStart: number;
  /** prevMonthStart + the time elapsed into this month, capped at monthStart so
   *  a 31st-of-March comparison never bleeds out of February. */
  prevMonthElapsedEnd: number;
  last30dStart: number;
  prev30dStart: number;
  seriesStart: number;
  /** "YYYY-MM" keys, oldest → newest, length SERIES_MONTHS. */
  seriesMonths: string[];
  /** Days elapsed in the current month, inclusive of today. */
  daysElapsed: number;
  /** Days in the current month. */
  daysInMonth: number;
}

function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function utcMonthStart(year: number, monthIndex: number): number {
  return Math.floor(Date.UTC(year, monthIndex, 1) / 1000);
}

/** Short label for a "YYYY-MM" key, e.g. "2026-03" → "Mar 26". */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  return `${name} ${String(y).slice(2)}`;
}

/**
 * Every boundary the aggregates need, derived from one `now`. UTC throughout:
 * Workers run in UTC and a report whose month boundary moves with the reader's
 * timezone is not a report anyone can reconcile.
 */
export function hitStatWindows(now: number): HitStatWindows {
  const d = new Date(now * 1000);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();

  const monthStart = utcMonthStart(year, month);
  const prevMonthStart = utcMonthStart(year, month - 1);
  const nextMonthStart = utcMonthStart(year, month + 1);

  // Cap keeps the like-for-like window inside the previous month: on 31 March
  // the elapsed offset would otherwise reach 3 March.
  const prevMonthElapsedEnd = Math.min(prevMonthStart + (now - monthStart), monthStart);

  const seriesMonths: string[] = [];
  for (let i = SERIES_MONTHS - 1; i >= 0; i--) {
    const md = new Date(Date.UTC(year, month - i, 1));
    seriesMonths.push(monthKey(md.getUTCFullYear(), md.getUTCMonth()));
  }

  const daysInMonth = Math.round((nextMonthStart - monthStart) / 86400);

  return {
    now,
    monthStart,
    prevMonthStart,
    prevMonthElapsedEnd,
    last30dStart: now - 30 * 86400,
    prev30dStart: now - 60 * 86400,
    seriesStart: utcMonthStart(year, month - (SERIES_MONTHS - 1)),
    seriesMonths,
    daysElapsed: d.getUTCDate(),
    daysInMonth,
  };
}

// ── Pure derivations ─────────────────────────────────────────────────────────

export function growth(current: number, previous: number): GrowthReading {
  const direction = current > previous ? "up" : current < previous ? "down" : "flat";
  const pct = previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;
  return { current, previous, pct, direction };
}

function slices(
  counts: { key: string; hits: number }[],
  total: number,
  label: (key: string) => string,
): BreakdownSlice[] {
  return counts
    .filter((c) => c.hits > 0)
    .map((c) => ({
      key: c.key,
      label: label(c.key),
      hits: c.hits,
      share: total > 0 ? Math.round((c.hits / total) * 100) : 0,
    }))
    .sort((a, b) => b.hits - a.hits || a.key.localeCompare(b.key));
}

const RISK_ORDER = ["critical", "high", "medium", "low"] as const;
const RISK_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export interface RollUpInput {
  perTalent: TalentHitAggregate[];
  /** Cohort-wide month buckets, "YYYY-MM" → hits. Sparse; missing = zero. */
  monthCounts: Record<string, number>;
  platformCounts: { key: string; hits: number }[];
  riskCounts: { key: string; hits: number }[];
  /** Earliest detection across the cohort, for the lifetime window caption. */
  firstDetectedAt: number | null;
}

/**
 * Assemble the report. Pure — every rate, projection and ordering decision the
 * two surfaces render is settled here rather than in either client.
 */
export function rollUpDeepfakeStats(
  input: RollUpInput,
  members: CohortMember[],
  windows: HitStatWindows,
): DeepfakeHitStats {
  const byTalent = new Map(input.perTalent.map((a) => [a.talentId, a]));

  const memberStats: MemberHitStats[] = members.map((m) => {
    const a = byTalent.get(m.talentId);
    return {
      name: m.name,
      talentId: m.talentId,
      total: a?.total ?? 0,
      open: a?.open ?? 0,
      confirmed: a?.confirmed ?? 0,
      takedownRequested: a?.takedownRequested ?? 0,
      resolved: a?.resolved ?? 0,
      dismissed: a?.dismissed ?? 0,
      highRisk: a?.highRisk ?? 0,
      thisMonth: a?.thisMonth ?? 0,
      prevMonthToDate: a?.prevMonthToDate ?? 0,
      prevMonthFull: a?.prevMonthFull ?? 0,
      last30d: a?.last30d ?? 0,
      prev30d: a?.prev30d ?? 0,
      latestAt: a?.latestAt ?? null,
    };
  });

  // Worst first: open hits, then lifetime volume, then recency. A member with
  // nothing sinks to the bottom rather than being hidden — "clean" is a result.
  memberStats.sort(
    (a, b) =>
      b.open - a.open ||
      b.total - a.total ||
      (b.latestAt ?? 0) - (a.latestAt ?? 0) ||
      a.name.localeCompare(b.name),
  );

  const sum = (pick: (a: MemberHitStats) => number) => memberStats.reduce((s, a) => s + pick(a), 0);
  const total = sum((a) => a.total);

  const months: MonthBucket[] = windows.seriesMonths.map((month) => ({
    month,
    label: monthLabel(month),
    hits: input.monthCounts[month] ?? 0,
  }));

  const thisMonthHits = sum((a) => a.thisMonth);
  const perDay = windows.daysElapsed > 0 ? thisMonthHits / windows.daysElapsed : 0;

  const currentMonthKey = windows.seriesMonths[windows.seriesMonths.length - 1];
  const prevMonthKey = windows.seriesMonths[windows.seriesMonths.length - 2];
  const monthBeforeKey = windows.seriesMonths[windows.seriesMonths.length - 3];

  const latestAt = memberStats.reduce<number | null>(
    (max, a) => (a.latestAt !== null && (max === null || a.latestAt > max) ? a.latestAt : max),
    null,
  );

  return {
    generatedAt: windows.now,
    cohort: {
      size: members.length,
      withHits: memberStats.filter((a) => a.total > 0).length,
      withOpenHits: memberStats.filter((a) => a.open > 0).length,
    },
    lifetime: {
      total,
      open: sum((a) => a.open),
      confirmed: sum((a) => a.confirmed),
      takedownRequested: sum((a) => a.takedownRequested),
      resolved: sum((a) => a.resolved),
      dismissed: sum((a) => a.dismissed),
      highRisk: sum((a) => a.highRisk),
      firstDetectedAt: input.firstDetectedAt,
      latestAt,
    },
    thisMonth: {
      month: currentMonthKey,
      label: monthLabel(currentMonthKey),
      hits: thisMonthHits,
      daysElapsed: windows.daysElapsed,
      perDay: Math.round(perDay * 10) / 10,
      projected: Math.round(perDay * windows.daysInMonth),
    },
    growth: {
      monthOnMonth: growth(thisMonthHits, sum((a) => a.prevMonthToDate)),
      completedMonths: growth(
        input.monthCounts[prevMonthKey] ?? 0,
        input.monthCounts[monthBeforeKey] ?? 0,
      ),
      rolling30d: growth(sum((a) => a.last30d), sum((a) => a.prev30d)),
    },
    months,
    byPlatform: slices(input.platformCounts, total, platformName),
    byRisk: slices(
      RISK_ORDER.map((key) => ({
        key,
        hits: input.riskCounts.find((r) => r.key === key)?.hits ?? 0,
      })),
      total,
      (key) => RISK_LABELS[key] ?? key,
    ),
    members: memberStats,
  };
}

// ── SQL ──────────────────────────────────────────────────────────────────────

const openCase = inArray(likenessHits.status, OPEN_STATUSES);

function countIf(condition: SQL) {
  return sql<number>`sum(case when ${condition} then 1 else 0 end)`;
}

function chunk<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

async function fetchPerTalent(
  db: Db,
  talentIds: string[],
  w: HitStatWindows,
): Promise<TalentHitAggregate[]> {
  const rows: TalentHitAggregate[] = [];
  for (const ids of chunk(talentIds)) {
    const chunkRows = await db
      .select({
        talentId: likenessHits.talentId,
        total: sql<number>`count(*)`,
        open: countIf(openCase),
        confirmed: countIf(sql`${likenessHits.status} = 'confirmed'`),
        takedownRequested: countIf(sql`${likenessHits.status} = 'takedown_requested'`),
        resolved: countIf(sql`${likenessHits.status} = 'resolved'`),
        dismissed: countIf(sql`${likenessHits.status} = 'dismissed'`),
        highRisk: countIf(sql`${likenessHits.riskLevel} in ('high','critical')`),
        thisMonth: countIf(sql`${likenessHits.detectedAt} >= ${w.monthStart}`),
        prevMonthToDate: countIf(
          sql`${likenessHits.detectedAt} >= ${w.prevMonthStart} and ${likenessHits.detectedAt} < ${w.prevMonthElapsedEnd}`,
        ),
        prevMonthFull: countIf(
          sql`${likenessHits.detectedAt} >= ${w.prevMonthStart} and ${likenessHits.detectedAt} < ${w.monthStart}`,
        ),
        last30d: countIf(sql`${likenessHits.detectedAt} >= ${w.last30dStart}`),
        prev30d: countIf(
          sql`${likenessHits.detectedAt} >= ${w.prev30dStart} and ${likenessHits.detectedAt} < ${w.last30dStart}`,
        ),
        latestAt: sql<number | null>`max(${likenessHits.detectedAt})`,
      })
      .from(likenessHits)
      .where(inArray(likenessHits.talentId, ids))
      .groupBy(likenessHits.talentId)
      .all();
    rows.push(...chunkRows);
  }
  return rows;
}

async function fetchMonthCounts(
  db: Db,
  talentIds: string[],
  w: HitStatWindows,
): Promise<Record<string, number>> {
  const bucket = sql<string>`strftime('%Y-%m', ${likenessHits.detectedAt}, 'unixepoch')`;
  const counts: Record<string, number> = {};
  for (const ids of chunk(talentIds)) {
    const rows = await db
      .select({ month: bucket, hits: sql<number>`count(*)` })
      .from(likenessHits)
      .where(and(inArray(likenessHits.talentId, ids), gte(likenessHits.detectedAt, w.seriesStart)))
      .groupBy(bucket)
      .all();
    for (const r of rows) counts[r.month] = (counts[r.month] ?? 0) + r.hits;
  }
  return counts;
}

async function fetchKeyCounts(
  db: Db,
  talentIds: string[],
  column: typeof likenessHits.platform | typeof likenessHits.riskLevel,
): Promise<{ key: string; hits: number }[]> {
  const merged: Record<string, number> = {};
  for (const ids of chunk(talentIds)) {
    const rows = await db
      .select({ key: column, hits: sql<number>`count(*)` })
      .from(likenessHits)
      .where(inArray(likenessHits.talentId, ids))
      .groupBy(column)
      .all();
    for (const r of rows) merged[r.key] = (merged[r.key] ?? 0) + r.hits;
  }
  return Object.entries(merged).map(([key, hits]) => ({ key, hits }));
}

async function fetchFirstDetectedAt(db: Db, talentIds: string[]): Promise<number | null> {
  let earliest: number | null = null;
  for (const ids of chunk(talentIds)) {
    const row = await db
      .select({ first: sql<number | null>`min(${likenessHits.detectedAt})` })
      .from(likenessHits)
      .where(inArray(likenessHits.talentId, ids))
      .get();
    if (row?.first != null && (earliest === null || row.first < earliest)) earliest = row.first;
  }
  return earliest;
}

/** The empty report — a cohort with no talent still renders a page. */
export function emptyDeepfakeHitStats(windows: HitStatWindows): DeepfakeHitStats {
  return rollUpDeepfakeStats(
    { perTalent: [], monthCounts: {}, platformCounts: [], riskCounts: [], firstDetectedAt: null },
    [],
    windows,
  );
}

/**
 * Build the full report for a cohort. `members` defines the cohort and carries
 * the display names — the caller owns who is in scope (union affiliation, rep
 * roster) and this module never widens it.
 */
export async function buildDeepfakeHitStats(
  db: Db,
  members: CohortMember[],
  now: number = Math.floor(Date.now() / 1000),
): Promise<DeepfakeHitStats> {
  const windows = hitStatWindows(now);
  const talentIds = members.map((m) => m.talentId);
  if (talentIds.length === 0) return emptyDeepfakeHitStats(windows);

  const [perTalent, monthCounts, platformCounts, riskCounts, firstDetectedAt] = await Promise.all([
    fetchPerTalent(db, talentIds, windows),
    fetchMonthCounts(db, talentIds, windows),
    fetchKeyCounts(db, talentIds, likenessHits.platform),
    fetchKeyCounts(db, talentIds, likenessHits.riskLevel),
    fetchFirstDetectedAt(db, talentIds),
  ]);

  return rollUpDeepfakeStats(
    { perTalent, monthCounts, platformCounts, riskCounts, firstDetectedAt },
    members,
    windows,
  );
}

export { OPEN_STATUSES, SERIES_MONTHS };
