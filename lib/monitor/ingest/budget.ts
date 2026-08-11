/**
 * Apify spend ceiling.
 *
 * Discovery is the first thing in this codebase that spends real money per
 * request against a third-party API we do not meter ourselves, so it gets a
 * hard gate rather than a dashboard. Mirrors lib/ai/cost-tracker.ts: settings
 * live in the shared key-value store, spend is summed from a usage log, and
 * the check is a precondition rather than an alert.
 *
 * Two properties make this an actual limit rather than an estimate:
 *
 *  1. Cost comes from Apify's own `usageTotalUsd` on the finished run, so the
 *     number we sum is the number they bill.
 *  2. The gate is re-checked between every query in a sweep, not just once at
 *     the top. A sweep issues up to a dozen runs; checking only at the start
 *     would let a single sweep overshoot the cap by eleven runs.
 *
 * It is still a second line of defence. The authoritative limit is the max
 * spend setting in the Apify console — that one is enforced by the party
 * holding the credit card. This one stops us asking.
 */

import { getDb } from "@/lib/db";
import { aiSettings, apifyUsage } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

export const APIFY_ENABLED_KEY = "apify_enabled";
export const APIFY_CEILING_KEY = "apify_budget_ceiling_usd";
export const APIFY_SINCE_KEY = "apify_budget_since";

/** Conservative default while testing. Overridable from /admin/monitor. */
export const DEFAULT_APIFY_CEILING_USD = 5.0;

/**
 * Fallback rate when a run reports no usage figure. Deliberately pessimistic —
 * over-counting stops a sweep early, under-counting overspends, and only one of
 * those is recoverable.
 */
const ESTIMATED_USD_PER_1K_ITEMS = 2.5;

export function estimateRunCost(itemCount: number): number {
  return (itemCount / 1000) * ESTIMATED_USD_PER_1K_ITEMS;
}

/**
 * Decide what a run actually cost.
 *
 * Observed live: Apify reports `usageTotalUsd: 0` on a freshly-finished run
 * that plainly did work — the figure is computed asynchronously and is not
 * populated by the time we read the terminal status. Trusting a literal zero
 * would book every run at nothing and leave the ceiling permanently unreached,
 * which is the exact failure mode a spend limit exists to prevent.
 *
 * So a zero is only believed when the run returned nothing to bill for.
 * Otherwise we fall back to the pessimistic per-item estimate and flag the row,
 * which keeps the gate conservative rather than blind.
 */
export function effectiveRunCost(
  reportedUsd: number | null | undefined,
  itemCount: number
): { costUsd: number; estimated: boolean } {
  if (typeof reportedUsd === "number" && reportedUsd > 0) {
    return { costUsd: reportedUsd, estimated: false };
  }
  if (itemCount === 0) {
    return { costUsd: 0, estimated: false };
  }
  return { costUsd: estimateRunCost(itemCount), estimated: true };
}

async function readSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.select({ value: aiSettings.value }).from(aiSettings).where(eq(aiSettings.key, key)).get();
  return row?.value ?? null;
}

export interface ApifyBudgetState {
  enabled: boolean;
  spent: number;
  ceiling: number;
  remaining: number;
  exhausted: boolean;
  since: number;
  runs: number;
}

/** Current spend against the ceiling, for both the gate and the admin view. */
export async function getApifyBudget(db: Db): Promise<ApifyBudgetState> {
  const [enabledRaw, ceilingRaw, sinceRaw] = await Promise.all([
    readSetting(db, APIFY_ENABLED_KEY),
    readSetting(db, APIFY_CEILING_KEY),
    readSetting(db, APIFY_SINCE_KEY),
  ]);

  const ceilingParsed = parseFloat(ceilingRaw ?? "");
  const ceiling = Number.isFinite(ceilingParsed) && ceilingParsed >= 0 ? ceilingParsed : DEFAULT_APIFY_CEILING_USD;
  const sinceParsed = parseInt(sinceRaw ?? "", 10);
  const since = Number.isFinite(sinceParsed) ? sinceParsed : 0;

  const row = await db
    .select({
      total: sql<number>`coalesce(sum(cost_usd), 0)`,
      runs: sql<number>`count(*)`,
    })
    .from(apifyUsage)
    .where(sql`created_at >= ${since}`)
    .get();

  const spent = row?.total ?? 0;

  return {
    // Absent setting means on: the token is the real switch, and a missing row
    // should not silently disable a feature an admin thinks is running.
    enabled: enabledRaw !== "false",
    spent,
    ceiling,
    remaining: Math.max(0, ceiling - spent),
    exhausted: spent >= ceiling,
    since,
    runs: row?.runs ?? 0,
  };
}

export interface BudgetVerdict {
  ok: boolean;
  reason: string | null;
  state: ApifyBudgetState;
}

/**
 * Call immediately before starting a run. `projectedCost` lets a caller refuse
 * a run it cannot afford even though the current total is still under.
 */
export async function checkApifyBudget(db: Db, projectedCost = 0): Promise<BudgetVerdict> {
  const state = await getApifyBudget(db);

  if (!state.enabled) {
    return { ok: false, reason: "Apify discovery is disabled in admin settings.", state };
  }
  if (state.exhausted) {
    return {
      ok: false,
      reason: `Apify spend limit reached — $${state.spent.toFixed(2)} of $${state.ceiling.toFixed(2)}. Raise or reset the ceiling in /admin/monitor.`,
      state,
    };
  }
  if (projectedCost > 0 && state.spent + projectedCost > state.ceiling) {
    return {
      ok: false,
      reason: `Next run would exceed the Apify spend limit ($${state.spent.toFixed(2)} spent, $${state.ceiling.toFixed(2)} ceiling).`,
      state,
    };
  }
  return { ok: true, reason: null, state };
}

export interface ApifyUsageEntry {
  runId: string | null;
  actorId: string;
  mode?: string | null;
  query?: string | null;
  talentId?: string | null;
  scanId?: string | null;
  itemCount: number;
  costUsd: number | null;
  status?: "succeeded" | "failed";
  error?: string | null;
}

/**
 * Record a run's spend. Called for failed runs too — Apify bills for compute on
 * a run that dies partway, so a failure that did not log would be spend the
 * ceiling cannot see.
 */
export async function logApifyUsage(db: Db, entry: ApifyUsageEntry): Promise<void> {
  const { costUsd, estimated } = effectiveRunCost(entry.costUsd, entry.itemCount);
  await db.insert(apifyUsage).values({
    id: crypto.randomUUID(),
    runId: entry.runId,
    actorId: entry.actorId,
    mode: entry.mode ?? null,
    query: entry.query ?? null,
    talentId: entry.talentId ?? null,
    scanId: entry.scanId ?? null,
    itemCount: entry.itemCount,
    costUsd,
    costEstimated: estimated,
    status: entry.status ?? "succeeded",
    error: entry.error ?? null,
    createdAt: Math.floor(Date.now() / 1000),
  });
}
