/**
 * Probe spend, tracked and capped.
 *
 * Probe runs cost real money per image (generation API) and per face compare
 * (Rekognition), which is a different order from the free/near-free monitor
 * sweeps and does NOT belong under callAi's tiny $1/14-day AI ceiling. So it
 * gets its own ledger — one probe_usage row per billed call, the same
 * "record the real number, not an estimate" discipline as apify_usage — and
 * its own admin-configurable ceiling in ai_settings under `probe_budget_usd`.
 *
 * A run is admitted only if its *estimate* fits under the remaining ceiling AND
 * the admin explicitly confirmed the spend. Nothing here can start a run on its
 * own — it only says yes or no to one an admin asked for.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { aiSettings, probeUsage } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

/** Fallback ceiling when the operator hasn't set one. Conservative — a handful
 *  of runs — so an unconfigured install can't rack up spend by surprise. */
export const DEFAULT_PROBE_BUDGET_USD = 25;

/** Rolling window the ceiling applies over, in seconds (14 days, matching the
 *  AI budget's cadence so the two windows are easy to reason about together). */
export const PROBE_BUDGET_WINDOW_SECONDS = 14 * 24 * 60 * 60;

export async function getProbeBudgetCeilingUsd(db: Db): Promise<number> {
  const row = await db
    .select({ value: aiSettings.value })
    .from(aiSettings)
    .where(eq(aiSettings.key, "probe_budget_usd"))
    .get();
  if (!row) return DEFAULT_PROBE_BUDGET_USD;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_PROBE_BUDGET_USD;
}

/** Total probe spend inside the rolling window. */
export async function getProbeSpendUsd(db: Db, now: number): Promise<number> {
  const since = now - PROBE_BUDGET_WINDOW_SECONDS;
  const row = await db
    .select({ total: sql<number>`coalesce(sum(${probeUsage.costUsd}), 0)` })
    .from(probeUsage)
    .where(gte(probeUsage.createdAt, since))
    .get();
  return row?.total ?? 0;
}

export interface BudgetCheck {
  ok: boolean;
  ceilingUsd: number;
  spentUsd: number;
  remainingUsd: number;
  estimateUsd: number;
  reason?: string;
}

/** Whether a run with this estimate may start. */
export async function checkProbeBudget(
  db: Db,
  estimateUsd: number,
  now: number
): Promise<BudgetCheck> {
  const ceilingUsd = await getProbeBudgetCeilingUsd(db);
  const spentUsd = await getProbeSpendUsd(db, now);
  const remainingUsd = Math.max(0, ceilingUsd - spentUsd);
  const ok = estimateUsd <= remainingUsd;
  return {
    ok,
    ceilingUsd,
    spentUsd,
    remainingUsd,
    estimateUsd,
    reason: ok
      ? undefined
      : `Estimated $${estimateUsd.toFixed(2)} exceeds the $${remainingUsd.toFixed(
          2
        )} left under the $${ceilingUsd.toFixed(2)} probe budget for the current 14-day window.`,
  };
}

export interface RecordProbeSpendInput {
  db: Db;
  runId: string | null;
  talentId: string | null;
  provider: "replicate" | "rekognition";
  kind: "generation" | "face_compare";
  units: number;
  costUsd: number;
  /** True when costUsd was derived from unit counts, not a provider-reported
   *  figure — so the report can flag which lines are measured vs estimated. */
  estimated: boolean;
  now: number;
}

/** Record one billed probe call. Fire-and-forget safe (own try/catch upstream). */
export async function recordProbeSpend(input: RecordProbeSpendInput): Promise<void> {
  await input.db.insert(probeUsage).values({
    id: crypto.randomUUID(),
    runId: input.runId,
    talentId: input.talentId,
    provider: input.provider,
    kind: input.kind,
    units: input.units,
    costUsd: input.costUsd,
    costEstimated: input.estimated,
    createdAt: input.now,
  });
}

/** Sum a run's actual recorded spend — written back to probe_runs.costActualUsd. */
export async function getRunSpendUsd(db: Db, runId: string): Promise<number> {
  const row = await db
    .select({ total: sql<number>`coalesce(sum(${probeUsage.costUsd}), 0)` })
    .from(probeUsage)
    .where(and(eq(probeUsage.runId, runId)))
    .get();
  return row?.total ?? 0;
}
