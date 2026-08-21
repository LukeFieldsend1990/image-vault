import { describe, it, expect } from "vitest";

import { mockChainDb } from "../../helpers/mocks";
import { isMonitorPlatformId } from "@/lib/monitor/platforms";
import { loadScanQueries, platformForMode, recordScanQueries } from "@/lib/monitor/scan-queries";

type Db = Parameters<typeof loadScanQueries>[0];

/**
 * Every mode string an ingest module writes to the query log, alongside the
 * surface it belongs to. Instagram is the odd one out: it predates the
 * platform-suffixed modes and still records the bare DiscoveryMode.
 */
const RECORDED_MODES: Record<string, string> = {
  hashtag: "instagram",
  account: "instagram",
  tiktok_search: "tiktok",
  x_search: "x",
  reddit_search: "reddit",
  pinterest_search: "pinterest",
  youtube_search: "youtube",
  google_serp: "google",
  getty_serp: "getty",
};

describe("platformForMode", () => {
  it("maps every recorded mode to a real registry platform", () => {
    for (const [mode, platform] of Object.entries(RECORDED_MODES)) {
      expect(platformForMode(mode), mode).toBe(platform);
      expect(isMonitorPlatformId(platform), platform).toBe(true);
    }
  });

  // A new surface that records an unrecognised mode must not be filed under
  // some other platform's name — "unknown" is visible in the admin view and
  // says plainly that the wiring is missing.
  it("refuses to guess for a mode it does not know", () => {
    expect(platformForMode("bluesky_firehose")).toBe("unknown");
    expect(platformForMode(null)).toBe("unknown");
  });

  it("reads instagram's user_search as instagram, not as a suffixed platform", () => {
    expect(platformForMode("user_search")).toBe("instagram");
  });
});

describe("recordScanQueries", () => {
  it("writes one row per term, defaulting cost and status", async () => {
    const { db, insertedRows } = mockChainDb();
    await recordScanQueries(db as unknown as Db, "scan-1", "talent-1", [
      { platform: "instagram", mode: "hashtag", query: "tomhardyai", resultCount: 42 },
      {
        platform: "tiktok",
        mode: "tiktok_search",
        query: "#tomhardydeepfake",
        resultCount: 0,
        costUsd: 0.02,
        status: "failed",
        error: "run_failed",
      },
    ]);

    const values = insertedRows[0].values as Array<Record<string, unknown>>;
    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({
      scanId: "scan-1",
      talentId: "talent-1",
      query: "tomhardyai",
      resultCount: 42,
      costUsd: 0,
      status: "succeeded",
      error: null,
    });
    expect(values[1]).toMatchObject({ status: "failed", error: "run_failed", costUsd: 0.02 });
  });

  it("writes nothing when a sweep issued no queries", async () => {
    const { db, insertedRows } = mockChainDb();
    await recordScanQueries(db as unknown as Db, "scan-1", "talent-1", []);
    expect(insertedRows).toHaveLength(0);
  });

  // A sweep that finds real misuse must not be lost because its bookkeeping
  // insert failed.
  it("swallows a write failure rather than failing the sweep", async () => {
    const throwing = {
      insert: () => ({
        values: () => {
          throw new Error("D1 unavailable");
        },
      }),
    };
    await expect(
      recordScanQueries(throwing as unknown as Db, "scan-1", "talent-1", [
        { platform: "instagram", mode: "hashtag", query: "tomhardyai", resultCount: 1 },
      ])
    ).resolves.toBeUndefined();
  });
});

describe("loadScanQueries", () => {
  it("attributes hits to the term that surfaced them, across platform-prefixed sources", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue([
      {
        scanId: "scan-1",
        platform: "instagram",
        mode: "hashtag",
        query: "tomhardyai",
        resultCount: 40,
        costUsd: 0.01,
        status: "succeeded",
        error: null,
      },
      {
        scanId: "scan-1",
        platform: "tiktok",
        mode: "tiktok_search",
        query: "#tomhardyai",
        resultCount: 12,
        costUsd: 0.02,
        status: "succeeded",
        error: null,
      },
      {
        scanId: "scan-1",
        platform: "getty",
        mode: "getty_serp",
        query: "tom hardy ai",
        resultCount: null,
        costUsd: 0.005,
        status: "succeeded",
        error: null,
      },
    ]);
    // Instagram writes the bare term; the other surfaces prefix their platform.
    enqueue([
      { scanId: "scan-1", platform: "instagram", discoverySource: "hashtag:tomhardyai" },
      { scanId: "scan-1", platform: "tiktok", discoverySource: "hashtag:tiktok:#tomhardyai" },
      { scanId: "scan-1", platform: "tiktok", discoverySource: "hashtag:tiktok:#tomhardyai" },
      { scanId: "scan-1", platform: "instagram", discoverySource: null },
    ]);

    const byScan = await loadScanQueries(db as unknown as Db, ["scan-1"]);
    const rows = byScan.get("scan-1") ?? [];
    const hits = Object.fromEntries(rows.map((r) => [r.platform, r.hitCount]));
    expect(hits).toEqual({ instagram: 1, tiktok: 2, getty: 0 });
    expect(rows.every((r) => r.fromLedger === false)).toBe(true);
  });

  it("falls back to the Apify ledger for sweeps that predate the query log, and says so", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue([]); // no logged rows
    enqueue([
      { scanId: "old-scan", platform: "instagram", discoverySource: "hashtag:tomhardyfaceswap" },
    ]);
    enqueue([
      {
        scanId: "old-scan",
        mode: "hashtag",
        query: "tomhardyfaceswap",
        itemCount: 7,
        costUsd: 0.03,
        status: "succeeded",
        error: null,
      },
    ]);

    const rows = (await loadScanQueries(db as unknown as Db, ["old-scan"])).get("old-scan") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      platform: "instagram",
      query: "tomhardyfaceswap",
      resultCount: 7,
      hitCount: 1,
      fromLedger: true,
    });
  });

  it("reads nothing for an empty scan list rather than querying for all scans", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue([{ scanId: "scan-1", platform: "instagram", mode: "hashtag", query: "x" }]);
    expect((await loadScanQueries(db as unknown as Db, [])).size).toBe(0);
  });
});
