import { describe, it, expect, vi } from "vitest";

// sweep-queue.ts transitively imports edge-only modules (db, email); the
// pure decision function never executes those paths
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import { decideSweepDelivery } from "@/lib/monitor/sweep-queue";

describe("decideSweepDelivery", () => {
  it("runs a first delivery for a running scan", () => {
    expect(
      decideSweepDelivery({ scanStatus: "running", attempts: 1, hasApifySpend: false })
    ).toEqual({ action: "run" });
  });

  it("skips when the scan row is missing", () => {
    const d = decideSweepDelivery({ scanStatus: null, attempts: 1, hasApifySpend: false });
    expect(d.action).toBe("skip");
  });

  it("skips a scan that already settled (failScan, completion, or lazy timeout)", () => {
    for (const scanStatus of ["complete", "error"]) {
      const d = decideSweepDelivery({ scanStatus, attempts: 2, hasApifySpend: true });
      expect(d.action).toBe("skip");
    }
  });

  it("re-runs a redelivery when the dead attempt never reached paid discovery", () => {
    expect(
      decideSweepDelivery({ scanStatus: "running", attempts: 2, hasApifySpend: false })
    ).toEqual({ action: "run" });
  });

  it("settles a redelivery as an error when Apify spend already exists — never double-spends", () => {
    for (const attempts of [2, 3, 4]) {
      const d = decideSweepDelivery({ scanStatus: "running", attempts, hasApifySpend: true });
      expect(d.action).toBe("fail");
      if (d.action === "fail") {
        expect(d.reason).toMatch(/paid discovery/);
      }
    }
  });

  it("ignores the spend ledger on a first delivery", () => {
    // A first delivery moments after beginLikenessScan cannot have spent; if
    // the ledger somehow says otherwise (clock skew, reused id), first
    // delivery still runs — the guard exists for redeliveries only.
    expect(
      decideSweepDelivery({ scanStatus: "running", attempts: 1, hasApifySpend: true })
    ).toEqual({ action: "run" });
  });
});
