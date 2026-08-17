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
export const APIFY_CREDITS_EXHAUSTED_KEY = "apify_credits_exhausted_at";

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

// ── Credits-exhaustion marker ────────────────────────────────────────────────
//
// The internal ledger only sees runs this app booked; the Apify account also
// burns credit on unbooked runs, proxy, storage and estimate drift. Observed
// live (2026-08-17): the panel showed $2.02 of a $5.00 ceiling while Apify was
// refusing runs with 402. When a 402 lands we write the moment down, and the
// admin panel shows it in red until a later run succeeds — a signal that works
// regardless of what the ledger believes or what the token may read.

/** Record that Apify refused a run for lack of credits. */
export async function noteApifyCreditsExhausted(db: Db): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await readSetting(db, APIFY_CREDITS_EXHAUSTED_KEY);
  if (existing) {
    await db
      .update(aiSettings)
      .set({ value: String(now), updatedAt: now })
      .where(eq(aiSettings.key, APIFY_CREDITS_EXHAUSTED_KEY));
  } else {
    await db.insert(aiSettings).values({
      key: APIFY_CREDITS_EXHAUSTED_KEY,
      value: String(now),
      updatedBy: null,
      updatedAt: now,
    });
  }
}

/** A run succeeded, so the account has credits again — clear the marker. */
export async function clearApifyCreditsExhausted(db: Db): Promise<void> {
  await db.delete(aiSettings).where(eq(aiSettings.key, APIFY_CREDITS_EXHAUSTED_KEY));
}

export async function getApifyCreditsExhaustedAt(db: Db): Promise<number | null> {
  const raw = await readSetting(db, APIFY_CREDITS_EXHAUSTED_KEY);
  const parsed = parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// ── Account-level usage (Apify's own numbers) ───────────────────────────────

export type ApifyAccountUsage =
  | { available: true; monthlyUsageUsd: number; maxMonthlyUsageUsd: number | null }
  | { available: false; reason: string };

/**
 * The account's real usage for the current billing cycle, from Apify's
 * /users/me/limits. This is the figure the internal ledger cannot see —
 * unbooked runs, proxy, storage — and the one that actually decides whether
 * the next run is refused. Requires a token with the "User: read" permission;
 * scoped run-only tokens get a clear unavailable reason instead of an error.
 */
export async function getApifyAccountUsage(token: string): Promise<ApifyAccountUsage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch("https://api.apify.com/v2/users/me/limits", {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return {
        available: false,
        reason: "Token cannot read account usage — mint one with the \"User: read\" permission to see real credit burn here.",
      };
    }
    if (!res.ok) {
      return { available: false, reason: `Apify returned ${res.status} for account usage.` };
    }
    const body = (await res.json()) as {
      data?: {
        current?: { monthlyUsageUsd?: number };
        limits?: { maxMonthlyUsageUsd?: number };
      };
    };
    const used = body.data?.current?.monthlyUsageUsd;
    if (typeof used !== "number") {
      return { available: false, reason: "Apify account usage response had no usage figure." };
    }
    return {
      available: true,
      monthlyUsageUsd: used,
      maxMonthlyUsageUsd:
        typeof body.data?.limits?.maxMonthlyUsageUsd === "number"
          ? body.data.limits.maxMonthlyUsageUsd
          : null,
    };
  } catch {
    return { available: false, reason: "Could not reach Apify for account usage." };
  } finally {
    clearTimeout(timer);
  }
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
