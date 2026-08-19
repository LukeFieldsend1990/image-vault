import { describe, it, expect } from "vitest";

import {
  MONITOR_PLANS,
  DEFAULT_MONITOR_PLAN,
  currentPeriodStart,
  evaluateMeter,
  isMonitorPlanId,
  monitorPlanDef,
  resolveAllowanceUsd,
} from "@/lib/monitor/metering";

describe("plan catalogue", () => {
  it("defaults to the unmetered internal plan, so existing monitors keep their pre-plan behaviour", () => {
    expect(DEFAULT_MONITOR_PLAN).toBe("internal");
    expect(monitorPlanDef("internal")?.monthlyAllowanceUsd).toBeNull();
  });

  it("meters every paid plan", () => {
    for (const plan of MONITOR_PLANS.filter((p) => p.id !== "internal")) {
      expect(plan.monthlyAllowanceUsd).toBeGreaterThan(0);
    }
  });

  it("rejects unknown plan ids", () => {
    expect(isMonitorPlanId("watch")).toBe(true);
    expect(isMonitorPlanId("premium")).toBe(false);
    expect(isMonitorPlanId(null)).toBe(false);
  });
});

describe("currentPeriodStart — UTC calendar months", () => {
  it("maps any moment to the first of its UTC month", () => {
    // 2026-08-19T21:00:00Z → 2026-08-01T00:00:00Z
    expect(currentPeriodStart(Date.UTC(2026, 7, 19, 21, 0, 0) / 1000)).toBe(Date.UTC(2026, 7, 1) / 1000);
  });

  it("rolls over exactly at the month boundary", () => {
    const julyEnd = Date.UTC(2026, 6, 31, 23, 59, 59) / 1000;
    const augustStart = Date.UTC(2026, 7, 1, 0, 0, 0) / 1000;
    expect(currentPeriodStart(julyEnd)).toBe(Date.UTC(2026, 6, 1) / 1000);
    expect(currentPeriodStart(augustStart)).toBe(Date.UTC(2026, 7, 1) / 1000);
  });

  it("handles the year boundary", () => {
    const newYear = Date.UTC(2027, 0, 1, 0, 0, 1) / 1000;
    expect(currentPeriodStart(newYear)).toBe(Date.UTC(2027, 0, 1) / 1000);
  });
});

describe("resolveAllowanceUsd — override beats plan default", () => {
  it("uses the plan default when no override is set", () => {
    expect(resolveAllowanceUsd("watch", null)).toBe(15);
    expect(resolveAllowanceUsd("guard", null)).toBe(100);
  });

  it("uses the explicit override when set, even on the unmetered plan", () => {
    expect(resolveAllowanceUsd("guard", 42)).toBe(42);
    // Metering an internal account is the point of an override.
    expect(resolveAllowanceUsd("internal", 5)).toBe(5);
  });

  it("a $0 override is a valid hard stop, not 'no override'", () => {
    expect(resolveAllowanceUsd("watch", 0)).toBe(0);
  });

  it("unknown or missing plan with no override is unmetered", () => {
    expect(resolveAllowanceUsd("internal", null)).toBeNull();
    expect(resolveAllowanceUsd(undefined, null)).toBeNull();
    expect(resolveAllowanceUsd("not-a-plan", null)).toBeNull();
  });

  it("ignores a nonsense override rather than accidentally unmetering", () => {
    expect(resolveAllowanceUsd("watch", Number.NaN)).toBe(15);
    expect(resolveAllowanceUsd("watch", -3)).toBe(15);
  });
});

describe("evaluateMeter — the gate decision", () => {
  it("unmetered always passes", () => {
    expect(evaluateMeter({ allowanceUsd: null, spentUsd: 9999 }).ok).toBe(true);
  });

  it("passes with headroom", () => {
    expect(evaluateMeter({ allowanceUsd: 15, spentUsd: 14.99 }).ok).toBe(true);
  });

  it("refuses once the allowance is reached, and says why", () => {
    const v = evaluateMeter({ allowanceUsd: 15, spentUsd: 15 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("$15.00 of $15.00");
  });

  it("refuses a projected run that would overrun, even with spend still under", () => {
    const v = evaluateMeter({ allowanceUsd: 15, spentUsd: 14 }, 2);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("would exceed");
  });

  it("a $0 allowance refuses everything — the hard-stop override", () => {
    expect(evaluateMeter({ allowanceUsd: 0, spentUsd: 0 }).ok).toBe(false);
  });
});
