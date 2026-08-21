import { describe, it, expect, vi } from "vitest";

// trial.ts transitively imports edge-only modules (db, email); the pure
// functions under test never execute those paths
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import {
  computeTrialQuota,
  computeTrialCoverage,
  summariseTrialPhotos,
  DEFAULT_TRIAL_RUN_LIMIT,
} from "@/lib/monitor/trial";
import { decideSweepDelivery } from "@/lib/monitor/sweep-queue";

describe("computeTrialQuota", () => {
  it("gives the default allowance with no grants and no usage", () => {
    const q = computeTrialQuota({ baseLimit: DEFAULT_TRIAL_RUN_LIMIT, extraGranted: 0, used: 0 });
    expect(q).toEqual({ limit: 3, used: 0, remaining: 3, extraGranted: 0 });
  });

  it("stacks granted extras on the base limit", () => {
    const q = computeTrialQuota({ baseLimit: 3, extraGranted: 2, used: 4 });
    expect(q.limit).toBe(5);
    expect(q.remaining).toBe(1);
  });

  it("never reports negative remaining, even after a limit reduction", () => {
    const q = computeTrialQuota({ baseLimit: 1, extraGranted: 0, used: 3 });
    expect(q.remaining).toBe(0);
  });

  it("clamps pathological negative inputs to zero", () => {
    const q = computeTrialQuota({ baseLimit: -5, extraGranted: -1, used: -2 });
    expect(q).toEqual({ limit: 0, used: 0, remaining: 0, extraGranted: 0 });
  });
});

describe("summariseTrialPhotos", () => {
  it("counts each kind independently", () => {
    const summary = summariseTrialPhotos([
      { kind: "face" },
      { kind: "face" },
      { kind: "full_body" },
      { kind: "scan_3d" },
    ]);
    expect(summary).toEqual({ faceCount: 2, bodyCount: 1, has3dScan: true });
  });
});

describe("computeTrialCoverage", () => {
  it("is baseline with only the TMDB headshot", () => {
    const c = computeTrialCoverage({ faceCount: 0, bodyCount: 0, has3dScan: false }, true);
    expect(c.tier).toBe("baseline");
  });

  it("is unanchored with nothing at all", () => {
    const c = computeTrialCoverage({ faceCount: 0, bodyCount: 0, has3dScan: false }, false);
    expect(c.tier).toBe("unanchored");
    expect(c.score).toBe(0);
  });

  it("anchors as soon as one face photo is uploaded", () => {
    const c = computeTrialCoverage({ faceCount: 1, bodyCount: 0, has3dScan: false }, true);
    expect(c.tier).toBe("anchored");
  });

  it("counts a 3D scan as full-body coverage", () => {
    const bare = computeTrialCoverage({ faceCount: 1, bodyCount: 0, has3dScan: false }, true);
    const withScan = computeTrialCoverage({ faceCount: 1, bodyCount: 0, has3dScan: true }, true);
    expect(withScan.score).toBeGreaterThan(bare.score);
  });

  it("reaches fortified with a full multi-angle set", () => {
    const c = computeTrialCoverage({ faceCount: 4, bodyCount: 1, has3dScan: true }, true);
    expect(c.tier).toBe("fortified");
    expect(c.score).toBeGreaterThanOrEqual(80);
  });

  it("coverage climbs monotonically as material is added — the meter never drops", () => {
    let last = -1;
    for (const summary of [
      { faceCount: 0, bodyCount: 0, has3dScan: false },
      { faceCount: 1, bodyCount: 0, has3dScan: false },
      { faceCount: 2, bodyCount: 0, has3dScan: false },
      { faceCount: 2, bodyCount: 1, has3dScan: false },
      { faceCount: 3, bodyCount: 1, has3dScan: true },
    ]) {
      const c = computeTrialCoverage(summary, true);
      expect(c.score).toBeGreaterThanOrEqual(last);
      last = c.score;
    }
  });
});

describe("trial sweep delivery (shared decideSweepDelivery semantics)", () => {
  it("runs a first delivery for a running trial", () => {
    expect(
      decideSweepDelivery({ scanStatus: "running", attempts: 1, hasApifySpend: false })
    ).toEqual({ action: "run" });
  });

  it("skips a draft trial — the run route never enqueued it", () => {
    const d = decideSweepDelivery({ scanStatus: "draft", attempts: 1, hasApifySpend: false });
    expect(d.action).toBe("skip");
  });

  it("settles a redelivery with prior Apify spend instead of re-spending", () => {
    const d = decideSweepDelivery({ scanStatus: "running", attempts: 2, hasApifySpend: true });
    expect(d.action).toBe("fail");
  });
});
