import { describe, it, expect, vi } from "vitest";

// progress.ts imports the db module for its types; nothing here opens a
// request context — the reporter takes an injected db.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import { createScanReporter, parseScanProgress, NOOP_REPORTER } from "@/lib/monitor/progress";

/**
 * Minimal Drizzle-shaped db double: records every progress snapshot written,
 * optionally failing writes to prove the reporter swallows the error.
 */
function mockDb(opts: { failWrites?: boolean } = {}) {
  const written: string[] = [];
  const db = {
    update: () => ({
      set: (values: { progressJson: string }) => ({
        where: async () => {
          if (opts.failWrites) throw new Error("D1 unavailable");
          written.push(values.progressJson);
        },
      }),
    }),
  };
  return { db: db as never, written };
}

describe("createScanReporter", () => {
  it("seeds every enabled platform as pending and narrates stage transitions", async () => {
    const { db, written } = mockDb();
    const r = createScanReporter(db, "scan-1", ["instagram", "tiktok"]);

    r.stage("discovering", "Sweeping platforms");
    r.platform("instagram", "sweeping");
    r.platform("instagram", "done", 7);
    r.note("Instagram Reels: 7 candidates collected");
    r.candidates(7);
    await r.flush();

    const last = parseScanProgress(written.at(-1));
    expect(last).not.toBeNull();
    expect(last!.stage).toBe("discovering");
    expect(last!.stageLabel).toBe("Sweeping platforms");
    expect(last!.platforms.instagram).toEqual({ status: "done", candidates: 7 });
    expect(last!.platforms.tiktok).toEqual({ status: "pending", candidates: null });
    expect(last!.candidatesFound).toBe(7);
    expect(last!.log.map((e) => e.text)).toContain("Instagram Reels: 7 candidates collected");
  });

  it("keeps a settled candidate count when a later call omits it", async () => {
    const { db, written } = mockDb();
    const r = createScanReporter(db, "scan-2", ["x"]);
    r.platform("x", "done", 3);
    r.platform("x", "done");
    await r.flush();
    expect(parseScanProgress(written.at(-1))!.platforms.x).toEqual({ status: "done", candidates: 3 });
  });

  it("caps the activity log so a chatty sweep cannot grow the row unbounded", async () => {
    const { db, written } = mockDb();
    const r = createScanReporter(db, "scan-3", []);
    for (let i = 0; i < 60; i++) r.note(`line ${i}`);
    await r.flush();
    const last = parseScanProgress(written.at(-1))!;
    expect(last.log.length).toBe(40);
    expect(last.log.at(-1)!.text).toBe("line 59");
    expect(last.log[0]!.text).toBe("line 20"); // oldest entries dropped
  });

  it("survives write failures — a progress snapshot is never allowed to fail a sweep", async () => {
    const { db } = mockDb({ failWrites: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const r = createScanReporter(db, "scan-4", ["reddit"]);
      r.note("first");
      r.note("second"); // the chain must keep flowing past the first failure
      await expect(r.flush()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("persists snapshots in call order so the last write is the freshest state", async () => {
    const { db, written } = mockDb();
    const r = createScanReporter(db, "scan-5", []);
    r.stage("preparing", "Anchoring identity");
    r.stage("finalizing", "Recording results");
    await r.flush();
    const stages = written.map((w) => parseScanProgress(w)!.stage);
    expect(stages).toEqual(["preparing", "finalizing"]);
  });
});

describe("parseScanProgress", () => {
  it("returns null for absent or malformed json", () => {
    expect(parseScanProgress(null)).toBeNull();
    expect(parseScanProgress(undefined)).toBeNull();
    expect(parseScanProgress("not json")).toBeNull();
    expect(parseScanProgress("{}")).toBeNull();
  });

  it("drops malformed log entries instead of failing the parse", () => {
    const parsed = parseScanProgress(
      JSON.stringify({
        stage: "discovering",
        stageLabel: "Sweeping platforms",
        platforms: {},
        candidatesFound: 2,
        log: [{ at: 1, text: "ok" }, { text: "no timestamp" }, "junk", null],
        updatedAt: 2,
      })
    );
    expect(parsed!.log).toEqual([{ at: 1, text: "ok" }]);
  });
});

describe("NOOP_REPORTER", () => {
  it("accepts the full interface without side effects", async () => {
    NOOP_REPORTER.stage("preparing", "x");
    NOOP_REPORTER.platform("instagram", "sweeping");
    NOOP_REPORTER.note("x");
    NOOP_REPORTER.candidates(1);
    await NOOP_REPORTER.flush();
  });
});
