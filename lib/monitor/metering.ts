/**
 * Per-talent sweep metering.
 *
 * The Apify ceiling in ./ingest/budget.ts is a platform-wide gate: one shared
 * pot protecting the Apify account. Selling the monitor as a monthly add-on
 * needs the complementary per-customer gate — each talent gets a monthly
 * discovery allowance from their plan, spend is attributed from the same
 * apify_usage ledger (which has carried talent_id from the start), and a
 * talent who runs out stops spending without touching anyone else's coverage.
 *
 * Both gates apply, global first: the ceiling protects the account, the meter
 * protects the margin on one subscription. Free surfaces (YouTube quota,
 * Civitai, pHash, provenance scans, LLaVA) cost nothing and are never gated —
 * an exhausted meter degrades paid discovery, it never turns the monitor off.
 *
 * Periods are UTC calendar months. Spend is summed from apify_usage rather
 * than counted down from a balance, so the meter needs no writes of its own
 * and stays consistent with the admin spend panel and the Apify invoice.
 */

import { getDb } from "@/lib/db";
import { apifyUsage, likenessMonitors } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

export type MonitorPlanId = "internal" | "watch" | "guard" | "shield";

export interface MonitorPlanDef {
  id: MonitorPlanId;
  label: string;
  /** Monthly paid-discovery allowance in USD. null = unmetered. */
  monthlyAllowanceUsd: number | null;
}

/**
 * Allowances are discovery COGS the plan tolerates, not prices, and are
 * PLACEHOLDERS pending commercial sign-off — same status as the amounts in
 * lib/financial/config.ts. "internal" is the pre-billing default every
 * existing monitor lands on: no per-talent gate, global ceiling only.
 */
export const MONITOR_PLANS: MonitorPlanDef[] = [
  { id: "internal", label: "Internal (unmetered)", monthlyAllowanceUsd: null },
  { id: "watch", label: "Watch", monthlyAllowanceUsd: 15 },
  { id: "guard", label: "Guard", monthlyAllowanceUsd: 100 },
  { id: "shield", label: "Shield", monthlyAllowanceUsd: 150 },
];

export const DEFAULT_MONITOR_PLAN: MonitorPlanId = "internal";

export function monitorPlanDef(id: string | null | undefined): MonitorPlanDef | undefined {
  return MONITOR_PLANS.find((p) => p.id === id);
}

export function isMonitorPlanId(v: unknown): v is MonitorPlanId {
  return typeof v === "string" && MONITOR_PLANS.some((p) => p.id === v);
}

/** Start of the UTC calendar month containing `nowUnix`, in unix seconds. */
export function currentPeriodStart(nowUnix: number): number {
  const d = new Date(nowUnix * 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
}

/**
 * The allowance in force for a talent: an explicit per-talent override beats
 * the plan default. An override on the unmetered plan still meters — that is
 * the point of an override.
 */
export function resolveAllowanceUsd(
  plan: string | null | undefined,
  overrideUsd: number | null | undefined
): number | null {
  if (typeof overrideUsd === "number" && Number.isFinite(overrideUsd) && overrideUsd >= 0) {
    return overrideUsd;
  }
  return monitorPlanDef(plan)?.monthlyAllowanceUsd ?? null;
}

export interface TalentMeterState {
  talentId: string;
  plan: MonitorPlanId;
  /** null = unmetered. */
  allowanceUsd: number | null;
  /** Explicit per-talent override, when one is set. */
  overrideUsd: number | null;
  spentUsd: number;
  /** null when unmetered. */
  remainingUsd: number | null;
  unmetered: boolean;
  exhausted: boolean;
  periodStart: number;
  runs: number;
}

export interface MeterVerdict {
  ok: boolean;
  reason: string | null;
}

/**
 * Pure gate decision, split out from the DB read so the enforcement logic is
 * unit-testable the way effectiveRunCost is. Copy is talent-safe: the upfront
 * refusal in discovery surfaces this string as the sweep's discoveryError.
 */
export function evaluateMeter(
  meter: Pick<TalentMeterState, "allowanceUsd" | "spentUsd">,
  projectedCost = 0
): MeterVerdict {
  if (meter.allowanceUsd === null) return { ok: true, reason: null };
  if (meter.spentUsd >= meter.allowanceUsd) {
    return {
      ok: false,
      reason:
        `Monthly discovery allowance reached — $${meter.spentUsd.toFixed(2)} of ` +
        `$${meter.allowanceUsd.toFixed(2)} this period. Paid discovery resumes next period.`,
    };
  }
  if (projectedCost > 0 && meter.spentUsd + projectedCost > meter.allowanceUsd) {
    return {
      ok: false,
      reason:
        `Next run would exceed the monthly discovery allowance ` +
        `($${meter.spentUsd.toFixed(2)} spent, $${meter.allowanceUsd.toFixed(2)} allowance).`,
    };
  }
  return { ok: true, reason: null };
}

/** Current meter for one talent: plan, allowance, and this period's spend. */
export async function getTalentMeter(
  db: Db,
  talentId: string,
  nowUnix = Math.floor(Date.now() / 1000)
): Promise<TalentMeterState> {
  const periodStart = currentPeriodStart(nowUnix);

  const [monitor, usage] = await Promise.all([
    db
      .select({ plan: likenessMonitors.plan, overrideUsd: likenessMonitors.monthlyBudgetUsd })
      .from(likenessMonitors)
      .where(eq(likenessMonitors.talentId, talentId))
      .get(),
    db
      .select({
        total: sql<number>`coalesce(sum(cost_usd), 0)`,
        runs: sql<number>`count(*)`,
      })
      .from(apifyUsage)
      .where(and(eq(apifyUsage.talentId, talentId), sql`created_at >= ${periodStart}`))
      .get(),
  ]);

  const plan = isMonitorPlanId(monitor?.plan) ? monitor.plan : DEFAULT_MONITOR_PLAN;
  const overrideUsd = monitor?.overrideUsd ?? null;
  const allowanceUsd = resolveAllowanceUsd(plan, overrideUsd);
  const spentUsd = usage?.total ?? 0;

  return {
    talentId,
    plan,
    allowanceUsd,
    overrideUsd,
    spentUsd,
    remainingUsd: allowanceUsd === null ? null : Math.max(0, allowanceUsd - spentUsd),
    unmetered: allowanceUsd === null,
    exhausted: allowanceUsd !== null && spentUsd >= allowanceUsd,
    periodStart,
    runs: usage?.runs ?? 0,
  };
}

export interface TalentBudgetVerdict extends MeterVerdict {
  state: TalentMeterState;
}

/**
 * Call before spending on a talent's behalf — same contract as
 * checkApifyBudget, and like it, re-checked between runs rather than once at
 * the top of a sweep.
 */
export async function checkTalentBudget(
  db: Db,
  talentId: string,
  projectedCost = 0
): Promise<TalentBudgetVerdict> {
  const state = await getTalentMeter(db, talentId);
  return { ...evaluateMeter(state, projectedCost), state };
}

/**
 * Every monitored talent's meter for the current period, for the admin spend
 * panel. Two grouped queries merged in JS rather than a join per talent —
 * D1 round-trips are the cost centre.
 */
export async function listTalentMeters(
  db: Db,
  nowUnix = Math.floor(Date.now() / 1000)
): Promise<TalentMeterState[]> {
  const periodStart = currentPeriodStart(nowUnix);

  const [monitors, usage] = await Promise.all([
    db
      .select({
        talentId: likenessMonitors.talentId,
        plan: likenessMonitors.plan,
        overrideUsd: likenessMonitors.monthlyBudgetUsd,
      })
      .from(likenessMonitors)
      .all(),
    db
      .select({
        talentId: apifyUsage.talentId,
        total: sql<number>`coalesce(sum(cost_usd), 0)`,
        runs: sql<number>`count(*)`,
      })
      .from(apifyUsage)
      .where(sql`created_at >= ${periodStart}`)
      .groupBy(apifyUsage.talentId)
      .all(),
  ]);

  const spendByTalent = new Map(usage.filter((u) => u.talentId).map((u) => [u.talentId!, u]));

  return monitors.map((m) => {
    const plan = isMonitorPlanId(m.plan) ? m.plan : DEFAULT_MONITOR_PLAN;
    const allowanceUsd = resolveAllowanceUsd(plan, m.overrideUsd);
    const spentUsd = spendByTalent.get(m.talentId)?.total ?? 0;
    return {
      talentId: m.talentId,
      plan,
      allowanceUsd,
      overrideUsd: m.overrideUsd ?? null,
      spentUsd,
      remainingUsd: allowanceUsd === null ? null : Math.max(0, allowanceUsd - spentUsd),
      unmetered: allowanceUsd === null,
      exhausted: allowanceUsd !== null && spentUsd >= allowanceUsd,
      periodStart,
      runs: spendByTalent.get(m.talentId)?.runs ?? 0,
    };
  });
}
