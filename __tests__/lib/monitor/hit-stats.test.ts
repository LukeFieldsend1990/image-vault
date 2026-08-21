import { describe, it, expect } from "vitest";

import {
  growth,
  hitStatWindows,
  monthLabel,
  rollUpDeepfakeStats,
  emptyDeepfakeHitStats,
  type RollUpInput,
  type TalentHitAggregate,
} from "@/lib/monitor/hit-stats";

const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000);

const agg = (overrides: Partial<TalentHitAggregate> & { talentId: string }): TalentHitAggregate => ({
  total: 0,
  open: 0,
  confirmed: 0,
  takedownRequested: 0,
  resolved: 0,
  dismissed: 0,
  highRisk: 0,
  thisMonth: 0,
  prevMonthToDate: 0,
  prevMonthFull: 0,
  last30d: 0,
  prev30d: 0,
  latestAt: null,
  ...overrides,
});

const input = (over: Partial<RollUpInput> = {}): RollUpInput => ({
  perTalent: [],
  monthCounts: {},
  platformCounts: [],
  riskCounts: [],
  firstDetectedAt: null,
  ...over,
});

describe("hitStatWindows", () => {
  it("anchors the month boundaries in UTC", () => {
    const w = hitStatWindows(ts("2026-03-17T09:30:00Z"));
    expect(w.monthStart).toBe(ts("2026-03-01T00:00:00Z"));
    expect(w.prevMonthStart).toBe(ts("2026-02-01T00:00:00Z"));
    expect(w.daysElapsed).toBe(17);
    expect(w.daysInMonth).toBe(31);
  });

  it("rolls the year backwards for January", () => {
    const w = hitStatWindows(ts("2026-01-05T00:00:00Z"));
    expect(w.prevMonthStart).toBe(ts("2025-12-01T00:00:00Z"));
    expect(w.seriesMonths[w.seriesMonths.length - 1]).toBe("2026-01");
    expect(w.seriesMonths[w.seriesMonths.length - 2]).toBe("2025-12");
    expect(w.seriesMonths[0]).toBe("2025-01");
  });

  it("returns 13 contiguous month keys, oldest first", () => {
    const w = hitStatWindows(ts("2026-08-21T12:00:00Z"));
    expect(w.seriesMonths).toHaveLength(13);
    expect(w.seriesMonths[0]).toBe("2025-08");
    expect(w.seriesMonths[12]).toBe("2026-08");
    expect([...w.seriesMonths].sort()).toEqual(w.seriesMonths);
    expect(w.seriesStart).toBe(ts("2025-08-01T00:00:00Z"));
  });

  it("truncates the like-for-like window to the same elapsed point last month", () => {
    // 17 days into March → the baseline is 1–17 February, not all of February.
    const w = hitStatWindows(ts("2026-03-17T00:00:00Z"));
    expect(w.prevMonthElapsedEnd).toBe(ts("2026-02-17T00:00:00Z"));
  });

  it("caps the like-for-like window at the month boundary when last month was shorter", () => {
    // 31 March is 30 days in; February 2026 has only 28, so an uncapped offset
    // would reach 3 March and double-count days that belong to this month.
    const w = hitStatWindows(ts("2026-03-31T00:00:00Z"));
    expect(w.prevMonthElapsedEnd).toBe(w.monthStart);
    expect(w.prevMonthElapsedEnd).toBe(ts("2026-03-01T00:00:00Z"));
  });

  it("handles leap-day boundaries", () => {
    const w = hitStatWindows(ts("2028-02-29T00:00:00Z"));
    expect(w.daysElapsed).toBe(29);
    expect(w.daysInMonth).toBe(29);
    expect(w.prevMonthStart).toBe(ts("2028-01-01T00:00:00Z"));
  });
});

describe("monthLabel", () => {
  it("renders a short month and two-digit year", () => {
    expect(monthLabel("2026-03")).toBe("Mar 26");
    expect(monthLabel("2025-12")).toBe("Dec 25");
  });

  it("passes through a malformed key rather than rendering NaN", () => {
    expect(monthLabel("nonsense")).toBe("nonsense");
  });
});

describe("growth", () => {
  it("computes percentage change to one decimal", () => {
    expect(growth(15, 12)).toEqual({ current: 15, previous: 12, pct: 25, direction: "up" });
    expect(growth(9, 12).pct).toBe(-25);
    expect(growth(7, 3).pct).toBe(133.3);
  });

  it("returns a null rate against a zero baseline instead of a fake infinity", () => {
    const g = growth(8, 0);
    expect(g.pct).toBeNull();
    expect(g.direction).toBe("up");
  });

  it("reports flat when nothing moved, including zero to zero", () => {
    expect(growth(0, 0)).toEqual({ current: 0, previous: 0, pct: null, direction: "flat" });
    expect(growth(4, 4).direction).toBe("flat");
  });
});

describe("rollUpDeepfakeStats", () => {
  const windows = hitStatWindows(ts("2026-03-17T00:00:00Z"));
  const members = [
    { talentId: "t1", name: "Ada Vance" },
    { talentId: "t2", name: "Bo Ellis" },
    { talentId: "t3", name: "Cleo Nash" },
  ];

  const populated = () =>
    rollUpDeepfakeStats(
      input({
        perTalent: [
          agg({
            talentId: "t1",
            total: 20,
            open: 5,
            confirmed: 3,
            takedownRequested: 2,
            resolved: 9,
            dismissed: 6,
            highRisk: 7,
            thisMonth: 4,
            prevMonthToDate: 2,
            prevMonthFull: 5,
            last30d: 6,
            prev30d: 4,
            latestAt: ts("2026-03-15T00:00:00Z"),
          }),
          agg({
            talentId: "t2",
            total: 3,
            open: 1,
            confirmed: 1,
            resolved: 2,
            thisMonth: 1,
            prevMonthToDate: 0,
            last30d: 1,
            prev30d: 0,
            latestAt: ts("2026-03-10T00:00:00Z"),
          }),
        ],
        monthCounts: { "2026-03": 5, "2026-02": 8, "2026-01": 4, "2025-11": 2 },
        platformCounts: [
          { key: "instagram", hits: 14 },
          { key: "tiktok", hits: 9 },
          { key: "reddit", hits: 0 },
        ],
        riskCounts: [
          { key: "high", hits: 6 },
          { key: "critical", hits: 1 },
          { key: "medium", hits: 16 },
        ],
        firstDetectedAt: ts("2025-11-04T00:00:00Z"),
      }),
      members,
      windows,
    );

  it("sums lifetime totals across the cohort", () => {
    const s = populated();
    expect(s.lifetime.total).toBe(23);
    expect(s.lifetime.open).toBe(6);
    expect(s.lifetime.resolved).toBe(11);
    expect(s.lifetime.dismissed).toBe(6);
    expect(s.lifetime.highRisk).toBe(7);
    expect(s.lifetime.firstDetectedAt).toBe(ts("2025-11-04T00:00:00Z"));
    expect(s.lifetime.latestAt).toBe(ts("2026-03-15T00:00:00Z"));
  });

  it("counts the cohort including members with no hits", () => {
    const s = populated();
    expect(s.cohort).toEqual({ size: 3, withHits: 2, withOpenHits: 2 });
    expect(s.members).toHaveLength(3);
    expect(s.members.find((m) => m.talentId === "t3")?.total).toBe(0);
  });

  it("projects the month at the pace so far", () => {
    const s = populated();
    expect(s.thisMonth.month).toBe("2026-03");
    expect(s.thisMonth.hits).toBe(5);
    expect(s.thisMonth.daysElapsed).toBe(17);
    // 5 hits over 17 days ≈ 0.3/day → ~9 across a 31-day month.
    expect(s.thisMonth.perDay).toBe(0.3);
    expect(s.thisMonth.projected).toBe(9);
  });

  it("compares month-to-date against the truncated previous month, not the whole of it", () => {
    const s = populated();
    // prevMonthToDate is 2, prevMonthFull is 5. Using the full month here would
    // report a fall when volume has in fact more than doubled.
    expect(s.growth.monthOnMonth).toEqual({
      current: 5,
      previous: 2,
      pct: 150,
      direction: "up",
    });
  });

  it("reads completed-month growth from the month buckets", () => {
    const s = populated();
    expect(s.growth.completedMonths).toEqual({
      current: 8, // 2026-02
      previous: 4, // 2026-01
      pct: 100,
      direction: "up",
    });
  });

  it("compares rolling 30 days against the preceding 30", () => {
    const s = populated();
    expect(s.growth.rolling30d).toEqual({ current: 7, previous: 4, pct: 75, direction: "up" });
  });

  it("fills the trend series with every month, zeros included", () => {
    const s = populated();
    expect(s.months).toHaveLength(13);
    expect(s.months[s.months.length - 1]).toEqual({ month: "2026-03", label: "Mar 26", hits: 5 });
    expect(s.months.find((m) => m.month === "2025-12")).toEqual({
      month: "2025-12",
      label: "Dec 25",
      hits: 0,
    });
    expect(s.months.reduce((sum, m) => sum + m.hits, 0)).toBe(19);
  });

  it("breaks down by platform, dropping empty slices and labelling ids", () => {
    const s = populated();
    expect(s.byPlatform.map((p) => p.key)).toEqual(["instagram", "tiktok"]);
    expect(s.byPlatform[0].label).toBe("Instagram Reels");
    // Shares are of lifetime hits: 14/23 ≈ 61%.
    expect(s.byPlatform[0].share).toBe(61);
  });

  it("orders risk slices by volume and keeps the risk keys", () => {
    const s = populated();
    expect(s.byRisk.map((r) => r.key)).toEqual(["medium", "high", "critical"]);
    expect(s.byRisk.map((r) => r.label)).toEqual(["Medium", "High", "Critical"]);
  });

  it("ranks members by open hits, then volume, then recency", () => {
    const s = populated();
    expect(s.members.map((m) => m.talentId)).toEqual(["t1", "t2", "t3"]);
    expect(s.members[0].name).toBe("Ada Vance");
  });

  it("keeps a roster member with no profile-side hits at zero rather than dropping them", () => {
    const s = populated();
    const clean = s.members.find((m) => m.talentId === "t3");
    expect(clean).toMatchObject({ name: "Cleo Nash", total: 0, open: 0, latestAt: null });
  });

  it("carries no hit content — counts only", () => {
    const s = populated();
    const serialised = JSON.stringify(s);
    for (const leak of ["contentUrl", "caption", "thumbnail", "authorHandle", "aiRationale"]) {
      expect(serialised).not.toContain(leak);
    }
  });
});

describe("emptyDeepfakeHitStats", () => {
  it("renders a complete zeroed report for a cohort with nobody in it", () => {
    const s = emptyDeepfakeHitStats(hitStatWindows(ts("2026-03-17T00:00:00Z")));
    expect(s.cohort).toEqual({ size: 0, withHits: 0, withOpenHits: 0 });
    expect(s.lifetime.total).toBe(0);
    expect(s.members).toEqual([]);
    expect(s.months).toHaveLength(13);
    expect(s.thisMonth.perDay).toBe(0);
    expect(s.thisMonth.projected).toBe(0);
    expect(s.growth.monthOnMonth.pct).toBeNull();
    expect(s.byPlatform).toEqual([]);
    expect(s.byRisk).toEqual([]);
  });
});
