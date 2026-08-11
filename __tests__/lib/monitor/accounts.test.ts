import { describe, it, expect, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import { priorityScore, formatCompact, type OffenderStatus } from "@/lib/monitor/accounts";

const NOW = 1_800_000_000;
const DAY = 86_400;

function score(over: Partial<Parameters<typeof priorityScore>[0]> = {}) {
  return priorityScore({
    cumulativeViews: 1_000,
    lastSeenAt: NOW - DAY,
    openHitsForTalent: 1,
    talentAffectedCount: 1,
    status: "watchlist" as OffenderStatus,
    now: NOW,
    ...over,
  });
}

describe("offender priority ranking", () => {
  it("ranks reach above raw post count", () => {
    // The whole thesis: a big account with one post outranks a tiny account
    // with many, because reach is what monetises.
    const big = score({ cumulativeViews: 2_000_000, openHitsForTalent: 1 });
    const small = score({ cumulativeViews: 300, openHitsForTalent: 3 });
    expect(big.score).toBeGreaterThan(small.score);
  });

  it("rewards recency — takedown value decays as views accrue", () => {
    const fresh = score({ lastSeenAt: NOW - DAY });
    const stale = score({ lastSeenAt: NOW - 90 * DAY });
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  it("escalates accounts hitting more than one protected talent", () => {
    const single = score({ talentAffectedCount: 1 });
    const multi = score({ talentAffectedCount: 3 });
    expect(multi.score).toBeGreaterThan(single.score);
    expect(multi.reason).toContain("3 protected talent");
  });

  it("zeroes out closed cases so they leave the queue", () => {
    expect(score({ status: "suspended", cumulativeViews: 5_000_000 }).score).toBe(0);
    expect(score({ status: "cleared", cumulativeViews: 5_000_000 }).score).toBe(0);
  });

  it("stays within 0-100 at absurd reach", () => {
    const s = score({ cumulativeViews: 900_000_000, talentAffectedCount: 40, openHitsForTalent: 99 });
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.score).toBeGreaterThan(0);
  });

  it("explains its own ranking", () => {
    const s = score({ cumulativeViews: 1_200_000, lastSeenAt: NOW - DAY });
    expect(s.reason).toContain("1.2M views");
    expect(s.reason).toContain("48h");
  });

  it("says so plainly when there is nothing much to act on", () => {
    expect(score({ cumulativeViews: 10, lastSeenAt: NOW - 200 * DAY, openHitsForTalent: 0 }).reason).toBe(
      "Low reach, no recent activity"
    );
  });
});

describe("compact number formatting", () => {
  it("keeps figures readable at every magnitude", () => {
    expect(formatCompact(940)).toBe("940");
    expect(formatCompact(1_200)).toBe("1.2k");
    expect(formatCompact(48_000)).toBe("48k");
    expect(formatCompact(1_200_000)).toBe("1.2M");
    expect(formatCompact(24_000_000)).toBe("24M");
  });
});
