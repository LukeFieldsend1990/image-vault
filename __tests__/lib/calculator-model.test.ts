import { describe, it, expect } from "vitest";
import {
  calculate,
  DEFAULT_ASSUMPTIONS,
  type AdvertisingInput,
  type CreditInput,
} from "@/lib/calculator/model";

const NOW = new Date("2026-06-01T00:00:00Z");
const NO_ADS: AdvertisingInput = { engagementsPerYear: 0, averageFee: 0 };

function credit(over: Partial<CreditInput> & { id: string }): CreditInput {
  return { releaseDate: null, scanned: false, reshoots: false, fee: 0, ...over };
}

describe("calculate — re-licensing a scan the production could have used", () => {
  it("pays 5% of a scanned production's own fee when an earlier scan was still live", () => {
    const result = calculate(
      [
        credit({ id: "first", releaseDate: "2020-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "second", releaseDate: "2021-06-01", scanned: true, fee: 200_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    // The second production needed a scan and one was already live, so it could
    // have licensed that one — 5% of its own fee, not the earlier job's.
    expect(result.credits.find((c) => c.id === "second")?.relicenceValue).toBe(10_000);
    expect(result.relicenceTotal).toBe(10_000);
    expect(result.relicensableCount).toBe(1);
  });

  it("pays nothing on the first scan of a cycle", () => {
    const result = calculate(
      [credit({ id: "first", releaseDate: "2020-01-01", scanned: true, fee: 100_000 })],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicenceTotal).toBe(0);
    expect(result.credits[0].isFirstScanOfCycle).toBe(true);
    expect(result.credits[0].couldHaveUsedScanId).toBeNull();
  });

  it("pays nothing on a credit that never scanned you, however live the scan", () => {
    // The job sits squarely inside the cycle but never needed a scan, so there
    // was no capture for it to replace.
    const result = calculate(
      [
        credit({ id: "scan", releaseDate: "2020-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "unscanned", releaseDate: "2021-01-01", fee: 500_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicenceTotal).toBe(0);
    expect(result.relicensableCount).toBe(0);
    expect(result.credits.find((c) => c.id === "unscanned")?.couldHaveUsedScanId).toBeNull();
  });

  it("pays every scan in a chain except the first", () => {
    const result = calculate(
      [
        credit({ id: "s1", releaseDate: "2019-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "s2", releaseDate: "2020-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "s3", releaseDate: "2021-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "s4", releaseDate: "2022-06-01", scanned: true, fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicensableCount).toBe(3);
    expect(result.relicenceTotal).toBe(15_000);
    expect(result.credits.find((c) => c.id === "s1")?.isFirstScanOfCycle).toBe(true);
  });

  it("starts a fresh cycle when the previous scan has expired", () => {
    const result = calculate(
      [
        credit({ id: "old", releaseDate: "2018-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "new", releaseDate: "2024-01-01", scanned: true, fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    // Six years apart: nothing was available to re-use, so the 2024 capture was
    // genuinely needed and is itself the start of a cycle.
    expect(result.relicenceTotal).toBe(0);
    expect(result.credits.find((c) => c.id === "new")?.isFirstScanOfCycle).toBe(true);
  });

  it("treats the look-back as half-open — a scan exactly a cycle old has expired", () => {
    const result = calculate(
      [
        credit({ id: "expired", releaseDate: "2020-01-01", scanned: true, fee: 0 }),
        credit({ id: "edge", releaseDate: "2023-01-01", scanned: true, fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.credits.find((c) => c.id === "edge")?.relicenceValue).toBe(0);
  });

  it("counts a scan just inside the look-back", () => {
    const result = calculate(
      [
        credit({ id: "live", releaseDate: "2020-01-02", scanned: true, fee: 0 }),
        credit({ id: "inside", releaseDate: "2023-01-01", scanned: true, fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.credits.find((c) => c.id === "inside")?.relicenceValue).toBe(5_000);
  });

  it("credits the most recent live scan, and charges the re-licence only once", () => {
    const result = calculate(
      [
        credit({ id: "older", releaseDate: "2020-01-01", scanned: true, fee: 0 }),
        credit({ id: "newer", releaseDate: "2021-01-01", scanned: true, fee: 0 }),
        credit({ id: "target", releaseDate: "2022-01-01", scanned: true, fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    const target = result.credits.find((c) => c.id === "target");
    expect(target?.couldHaveUsedScanId).toBe("newer");
    expect(target?.relicenceValue).toBe(5_000);
    expect(result.relicenceTotal).toBe(5_000);
  });

  it("ignores a scanned credit with no release date, as anchor and as claimant", () => {
    const result = calculate(
      [
        credit({ id: "undated", releaseDate: null, scanned: true, fee: 100_000 }),
        credit({ id: "dated", releaseDate: "2024-01-01", scanned: true, fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicenceTotal).toBe(0);
    // It still counts as a scan the visitor told us about.
    expect(result.scannedCount).toBe(2);
  });

  it("is unaffected by the order credits arrive in", () => {
    const rows = [
      credit({ id: "s3", releaseDate: "2021-01-01", scanned: true, fee: 100_000 }),
      credit({ id: "s1", releaseDate: "2019-01-01", scanned: true, fee: 100_000 }),
      credit({ id: "s2", releaseDate: "2020-01-01", scanned: true, fee: 100_000 }),
    ];

    const result = calculate(rows, NO_ADS, DEFAULT_ASSUMPTIONS, NOW);

    expect(result.credits.find((c) => c.id === "s1")?.isFirstScanOfCycle).toBe(true);
    expect(result.relicenceTotal).toBe(10_000);
  });
});

describe("calculate — scanned credits with no fee", () => {
  /**
   * A re-licence is charged against the scanned production's own fee, so a
   * qualifying row with a blank fee contributes nothing. A non-zero count next
   * to £0 reads as a broken calculator, so the result says how many are unpriced.
   */
  it("reports how many qualifying scans are still missing a fee", () => {
    const result = calculate(
      [
        credit({ id: "first", releaseDate: "2021-01-01", scanned: true, fee: 9_000_000 }),
        credit({ id: "priced", releaseDate: "2022-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "blank-1", releaseDate: "2022-06-01", scanned: true }),
        credit({ id: "blank-2", releaseDate: "2023-01-01", scanned: true }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicensableCount).toBe(3);
    expect(result.relicensableWithoutFee).toBe(2);
    expect(result.relicenceTotal).toBe(5_000);
  });

  it("counts nothing as missing once every qualifying scan is priced", () => {
    const result = calculate(
      [
        credit({ id: "first", releaseDate: "2021-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "later", releaseDate: "2022-01-01", scanned: true, fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicensableWithoutFee).toBe(0);
    expect(result.relicenceTotal).toBe(5_000);
  });

  it("does not count the first scan of a cycle, priced or not", () => {
    const result = calculate(
      [credit({ id: "first", releaseDate: "2021-01-01", scanned: true })],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicensableWithoutFee).toBe(0);
  });

  it("does not count an unpriced credit that was never scanned", () => {
    const result = calculate(
      [
        credit({ id: "first", releaseDate: "2021-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "unscanned", releaseDate: "2022-01-01" }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicensableCount).toBe(0);
    expect(result.relicensableWithoutFee).toBe(0);
  });
});
describe("calculate — reshoots", () => {
  it("pays 2% of the credit's own fee", () => {
    const result = calculate(
      [credit({ id: "a", releaseDate: "2024-01-01", reshoots: true, fee: 250_000 })],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.reshootTotal).toBe(5_000);
    expect(result.reshootCount).toBe(1);
  });

  it("stacks with a re-licence on the same credit", () => {
    const result = calculate(
      [
        credit({ id: "scan", releaseDate: "2022-01-01", scanned: true, fee: 0 }),
        credit({ id: "both", releaseDate: "2023-01-01", scanned: true, reshoots: true, fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    const both = result.credits.find((c) => c.id === "both");
    expect(both?.relicenceValue).toBe(5_000);
    expect(both?.reshootValue).toBe(2_000);
    expect(both?.total).toBe(7_000);
  });

  it("applies to the first scan of a cycle too — the scan gets called on again", () => {
    const result = calculate(
      [credit({ id: "a", releaseDate: "2024-01-01", scanned: true, reshoots: true, fee: 100_000 })],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.reshootTotal).toBe(2_000);
    expect(result.relicenceTotal).toBe(0);
  });

  it("applies to a credit that was never scanned — pickups are their own ask", () => {
    const result = calculate(
      [credit({ id: "a", releaseDate: "2024-01-01", reshoots: true, fee: 100_000 })],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.reshootTotal).toBe(2_000);
  });
});

describe("calculate — advertising", () => {
  it("pays the full average fee for every year a scan was live", () => {
    // A 2022 scan runs a full 3-year cycle, all of it in the past by 2026.
    const result = calculate(
      [credit({ id: "scan", releaseDate: "2022-05-01", scanned: true, fee: 0 })],
      { engagementsPerYear: 2, averageFee: 15_000 },
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.coveredYears).toBe(3);
    expect(result.advertisingTotal).toBe(90_000);
  });

  it("measures a mid-year cycle as three years, not four calendar years", () => {
    // 2022-05-01 → 2025-05-01 touches 2022, 2023, 2024 and 2025 on a calendar,
    // but is three years of cover. Counting calendar years would overpay by a third.
    const result = calculate(
      [credit({ id: "scan", releaseDate: "2022-05-01", scanned: true, fee: 0 })],
      { engagementsPerYear: 1, averageFee: 10_000 },
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.advertisingTotal).toBe(30_000);
  });

  it("pays nothing when no scan is marked", () => {
    const result = calculate(
      [credit({ id: "a", releaseDate: "2022-05-01", fee: 100_000 })],
      { engagementsPerYear: 4, averageFee: 20_000 },
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.coveredYears).toBe(0);
    expect(result.advertisingTotal).toBe(0);
  });

  it("merges overlapping cycles rather than counting the overlap twice", () => {
    // 2022-01-01→2025-01-01 and 2023-01-01→2026-01-01 union to four years,
    // not the six years the two cycles add up to separately.
    const result = calculate(
      [
        credit({ id: "s1", releaseDate: "2022-01-01", scanned: true, fee: 0 }),
        credit({ id: "s2", releaseDate: "2023-01-01", scanned: true, fee: 0 }),
      ],
      { engagementsPerYear: 1, averageFee: 10_000 },
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.coveredYears).toBeCloseTo(4, 1);
    expect(result.advertisingTotal).toBeCloseTo(40_000, -1);
  });

  it("stops coverage at today — years that haven't happened aren't money lost", () => {
    // A 2025-06-01 scan runs to 2028, but "now" is 2026-06-01: one year of cover.
    const result = calculate(
      [credit({ id: "s", releaseDate: "2025-06-01", scanned: true, fee: 0 })],
      { engagementsPerYear: 1, averageFee: 1_000 },
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.coveredYears).toBeCloseTo(1, 1);
  });

  it("clips coverage at the start of the lookback window", () => {
    // A 2016-06-01 scan's cycle mostly predates the 2017–2026 window; only the
    // part from 1 Jan 2017 to 1 Jun 2019 counts.
    const result = calculate(
      [credit({ id: "s", releaseDate: "2016-06-01", scanned: true, fee: 0 })],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.coveredYears).toBeCloseTo(2.42, 1);
  });
});

describe("calculate — totals and hygiene", () => {
  it("sums the three streams and reports uplift against declared fees", () => {
    const result = calculate(
      [
        credit({ id: "scan", releaseDate: "2023-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "later", releaseDate: "2024-01-01", scanned: true, reshoots: true, fee: 100_000 }),
      ],
      { engagementsPerYear: 1, averageFee: 10_000 },
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    // 5% of 100k re-licence + 2% of 100k reshoot + ads over the merged cover of
    // both scan cycles, clipped at today: 2023-01-01 to 2026-06-01 is 3.41 years.
    expect(result.relicenceTotal).toBe(5_000);
    expect(result.reshootTotal).toBe(2_000);
    expect(result.coveredYears).toBe(3.41);
    expect(result.advertisingTotal).toBe(34_100);
    expect(result.total).toBe(41_100);
    expect(result.feeTotal).toBe(200_000);
    expect(result.upliftPercent).toBe(20.55);
  });

  it("reports no uplift percentage when no fees were entered", () => {
    const result = calculate(
      [credit({ id: "a", releaseDate: "2024-01-01", scanned: true })],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.upliftPercent).toBeNull();
  });

  it("treats negative and non-finite inputs as zero rather than subtracting", () => {
    const result = calculate(
      [
        credit({ id: "scan", releaseDate: "2023-01-01", scanned: true, fee: 0 }),
        credit({ id: "bad", releaseDate: "2024-01-01", fee: -50_000 }),
        credit({ id: "nan", releaseDate: "2024-02-01", fee: Number.NaN }),
      ],
      { engagementsPerYear: -3, averageFee: Number.POSITIVE_INFINITY },
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.total).toBe(0);
    expect(result.feeTotal).toBe(0);
  });

  it("honours changed assumptions", () => {
    const result = calculate(
      [
        credit({ id: "scan", releaseDate: "2018-01-01", scanned: true, fee: 0 }),
        credit({ id: "later", releaseDate: "2022-01-01", scanned: true, fee: 100_000 }),
      ],
      NO_ADS,
      { ...DEFAULT_ASSUMPTIONS, scanCycleYears: 5, relicenceRate: 0.1 },
      NOW,
    );

    // The 5-year look-back now reaches back to the 2018 scan, and the rate is 10%.
    expect(result.relicenceTotal).toBe(10_000);
  });

  it("handles a malformed release date without throwing", () => {
    const result = calculate(
      [
        credit({ id: "scan", releaseDate: "not-a-date", scanned: true, fee: 0 }),
        credit({ id: "other", releaseDate: "", fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.total).toBe(0);
    expect(result.coveredYears).toBe(0);
  });
});
