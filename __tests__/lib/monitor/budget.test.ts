import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import {
  estimateRunCost,
  effectiveRunCost,
  DEFAULT_APIFY_CEILING_USD,
} from "@/lib/monitor/ingest/budget";
import { discoverInstagram } from "@/lib/monitor/ingest/instagram";
import type { TalentIdentityAnchor } from "@/lib/monitor/types";

// Titles included so the plan is long enough for the ceiling to bite partway
// through rather than after the last query.
const HARDY: TalentIdentityAnchor = {
  fullName: "Tom Hardy",
  knownForTitles: ["Venom", "Mad Max"],
  scanPackageCount: 1,
  geometryFingerprintCount: 0,
};

/** Apify transport double: every run succeeds, reporting `cost` per run. */
function stubApify(cost: number, itemsPerRun = 1) {
  let runs = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/runs?")) {
        runs++;
        return new Response(
          JSON.stringify({
            data: { id: `r${runs}`, defaultDatasetId: `d${runs}`, status: "SUCCEEDED", usageTotalUsd: cost },
          })
        );
      }
      if (url.includes("/actor-runs/")) {
        return new Response(JSON.stringify({ data: { status: "SUCCEEDED", usageTotalUsd: cost } }));
      }
      return new Response(
        JSON.stringify(
          Array.from({ length: itemsPerRun }, (_, i) => ({
            url: `https://www.instagram.com/reel/R${runs}_${i}/`,
            ownerUsername: `ai.forge${runs}`,
            caption: "Tom Hardy AI generated",
            hashtags: ["tomhardyai"],
          }))
        )
      );
    })
  );
  return () => runs;
}

/** Budget double enforcing a hard ceiling over accumulated spend. */
function budgetHarness(ceiling: number) {
  let spent = 0;
  const recorded: Array<{ costUsd: number | null; status: string }> = [];
  return {
    recorded,
    spent: () => spent,
    budget: {
      check: async () =>
        spent >= ceiling
          ? { ok: false, reason: `Apify spend limit reached — $${spent.toFixed(2)} of $${ceiling.toFixed(2)}.` }
          : { ok: true, reason: null },
      record: async (entry: { costUsd: number | null; status: string }) => {
        spent += entry.costUsd ?? 0;
        recorded.push({ costUsd: entry.costUsd, status: entry.status });
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Apify spend enforcement", () => {
  it("stops mid-sweep once the ceiling is crossed", async () => {
    // 6 queries planned, $1 each, $2.50 ceiling → 3 runs then stop.
    const runCount = stubApify(1.0);
    const h = budgetHarness(2.5);

    const { diagnostics } = await discoverInstagram({
      token: "t",
      anchor: HARDY,
      scope: "ai_only",
      budget: h.budget,
    });

    expect(runCount()).toBe(3);
    expect(diagnostics.queriesRun).toBe(3);
    expect(diagnostics.budgetStopped).toContain("spend limit reached");
    expect(h.spent()).toBe(3);
  });

  it("refuses to run at all when already exhausted, and says why", async () => {
    const runCount = stubApify(1.0);
    const h = budgetHarness(0);

    const { candidates, diagnostics } = await discoverInstagram({
      token: "t",
      anchor: HARDY,
      scope: "ai_only",
      budget: h.budget,
    });

    expect(runCount()).toBe(0);
    expect(candidates).toHaveLength(0);
    // With nothing attempted, the sweep must report the budget as the cause
    // rather than claiming discovery failed.
    expect(diagnostics.fatalError).toContain("spend limit reached");
  });

  it("books spend from runs that started and then failed", async () => {
    // Apify bills compute on a run that dies, so an unbooked failure would be
    // invisible spend.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/runs?")
          ? new Response(
              JSON.stringify({ data: { id: "r1", defaultDatasetId: "d1", status: "FAILED", usageTotalUsd: 0.4 } })
            )
          : new Response(JSON.stringify({ data: { status: "FAILED", usageTotalUsd: 0.4 } }))
      )
    );
    const h = budgetHarness(1.0);

    await discoverInstagram({ token: "t", anchor: HARDY, scope: "ai_only", budget: h.budget });

    expect(h.recorded.every((r) => r.status === "failed")).toBe(true);
    expect(h.spent()).toBeGreaterThan(0);
  });

  it("totals the sweep's real cost from Apify's own usage figures", async () => {
    stubApify(0.25);
    const h = budgetHarness(100);

    const { diagnostics } = await discoverInstagram({
      token: "t",
      anchor: HARDY,
      scope: "ai_only",
      budget: h.budget,
    });

    expect(diagnostics.costUsd).toBeCloseTo(0.25 * diagnostics.queriesRun, 5);
    expect(h.recorded.every((r) => r.costUsd === 0.25)).toBe(true);
  });

  it("runs unmetered only when no budget is supplied", async () => {
    const runCount = stubApify(5.0);
    const { diagnostics } = await discoverInstagram({ token: "t", anchor: HARDY, scope: "ai_only" });
    expect(runCount()).toBeGreaterThan(1);
    expect(diagnostics.budgetStopped).toBeNull();
  });
});

describe("effectiveRunCost — observed live behaviour", () => {
  it("does not believe a $0 report from a run that returned items", () => {
    // Apify computes usage asynchronously: a run that plainly did work reports
    // usageTotalUsd: 0 at the moment it flips to SUCCEEDED. Booking that
    // literally would record every run at nothing and the ceiling would never
    // trip — the precise failure a spend limit exists to prevent.
    const r = effectiveRunCost(0, 3);
    expect(r.estimated).toBe(true);
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it("believes $0 when there was genuinely nothing to bill for", () => {
    expect(effectiveRunCost(0, 0)).toEqual({ costUsd: 0, estimated: false });
  });

  it("takes a real positive figure at face value", () => {
    expect(effectiveRunCost(0.37, 100)).toEqual({ costUsd: 0.37, estimated: false });
  });

  it("estimates when nothing was reported at all", () => {
    const r = effectiveRunCost(null, 200);
    expect(r.estimated).toBe(true);
    expect(r.costUsd).toBeCloseTo(0.5, 5);
  });
});

describe("cost estimation fallback", () => {
  it("is pessimistic, so a missing usage figure stops a sweep early rather than late", () => {
    expect(estimateRunCost(1000)).toBe(2.5);
    expect(estimateRunCost(100)).toBeCloseTo(0.25, 5);
    expect(estimateRunCost(0)).toBe(0);
  });

  it("defaults the ceiling low enough to be a test budget", () => {
    expect(DEFAULT_APIFY_CEILING_USD).toBe(5);
  });
});
