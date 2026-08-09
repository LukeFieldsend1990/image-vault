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

describe("calculate — re-licensing inside the scan cycle", () => {
  it("pays 5% of a later credit's fee when it falls inside a scan's 3-year cycle", () => {
    const result = calculate(
      [
        credit({ id: "a", releaseDate: "2020-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "b", releaseDate: "2021-06-01", fee: 200_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.credits.find((c) => c.id === "b")?.relicenceValue).toBe(10_000);
    expect(result.relicenceTotal).toBe(10_000);
    expect(result.relicensableCount).toBe(1);
  });

  it("pays nothing on the production the scan came from", () => {
    const result = calculate(
      [credit({ id: "a", releaseDate: "2020-01-01", scanned: true, fee: 100_000 })],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicenceTotal).toBe(0);
    expect(result.credits[0].isScanOrigin).toBe(true);
    expect(result.credits[0].coveredByScanId).toBeNull();
  });

  it("excludes credits that fall outside the cycle, in either direction", () => {
    const result = calculate(
      [
        credit({ id: "before", releaseDate: "2019-01-01", fee: 100_000 }),
        credit({ id: "scan", releaseDate: "2020-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "after", releaseDate: "2023-06-01", fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicenceTotal).toBe(0);
    expect(result.relicensableCount).toBe(0);
  });

  it("treats the cycle as half-open — the boundary date is out", () => {
    const result = calculate(
      [
        credit({ id: "scan", releaseDate: "2020-01-01", scanned: true, fee: 0 }),
        credit({ id: "edge", releaseDate: "2023-01-01", fee: 100_000 }),
        credit({ id: "inside", releaseDate: "2022-12-31", fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.credits.find((c) => c.id === "edge")?.relicenceValue).toBe(0);
    expect(result.credits.find((c) => c.id === "inside")?.relicenceValue).toBe(5_000);
  });

  it("counts a credit covered by two overlapping cycles only once", () => {
    const result = calculate(
      [
        credit({ id: "scan1", releaseDate: "2020-01-01", scanned: true, fee: 0 }),
        credit({ id: "scan2", releaseDate: "2021-01-01", scanned: true, fee: 0 }),
        credit({ id: "covered", releaseDate: "2022-01-01", fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicenceTotal).toBe(5_000);
    expect(result.relicensableCount).toBe(1);
  });

  it("ignores a scanned credit with no release date as a cycle anchor", () => {
    const result = calculate(
      [
        credit({ id: "scan", releaseDate: null, scanned: true, fee: 0 }),
        credit({ id: "other", releaseDate: "2024-01-01", fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicenceTotal).toBe(0);
    // It still counts as a scan the visitor told us about.
    expect(result.scannedCount).toBe(1);
  });
});

describe("calculate — covered credits with no fee", () => {
  /**
   * The failure this guards against: an actor prices only the jobs that scanned
   * them, because that is what the page asked for. Those rows are the scan
   * origins, which earn no re-licence — so the biggest component reads £0 while
   * its own caption says a dozen credits qualify.
   */
  it("reports how many covered credits are still missing a fee", () => {
    const result = calculate(
      [
        credit({ id: "scan", releaseDate: "2021-01-01", scanned: true, fee: 9_000_000 }),
        credit({ id: "priced", releaseDate: "2022-01-01", fee: 100_000 }),
        credit({ id: "blank-1", releaseDate: "2022-06-01" }),
        credit({ id: "blank-2", releaseDate: "2023-01-01" }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicensableCount).toBe(3);
    expect(result.relicensableWithoutFee).toBe(2);
    expect(result.relicenceTotal).toBe(5_000);
  });

  it("flags every covered credit when fees went only on the scanned rows", () => {
    const credits = [credit({ id: "scan", releaseDate: "2021-01-01", scanned: true, fee: 9_000_000 })];
    for (let i = 0; i < 3; i++) {
      credits.push(credit({ id: `blank-${i}`, releaseDate: `2022-0${i + 1}-01` }));
    }

    const result = calculate(credits, NO_ADS, DEFAULT_ASSUMPTIONS, NOW);

    expect(result.relicenceTotal).toBe(0);
    expect(result.relicensableCount).toBe(3);
    expect(result.relicensableWithoutFee).toBe(3);
  });

  it("counts nothing as missing once every covered credit is priced", () => {
    const result = calculate(
      [
        credit({ id: "scan", releaseDate: "2021-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "later", releaseDate: "2022-01-01", fee: 100_000 }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicensableWithoutFee).toBe(0);
    expect(result.relicenceTotal).toBe(5_000);
  });

  it("does not count a blank credit that no scan cycle reaches", () => {
    const result = calculate(
      [
        credit({ id: "scan", releaseDate: "2021-01-01", scanned: true, fee: 100_000 }),
        credit({ id: "far-future", releaseDate: "2025-01-01" }),
      ],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.relicensableCount).toBe(0);
    expect(result.relicensableWithoutFee).toBe(0);
  });

  it("does not count the scan origin itself, priced or not", () => {
    const result = calculate(
      [credit({ id: "scan", releaseDate: "2021-01-01", scanned: true })],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

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
        credit({ id: "both", releaseDate: "2023-01-01", reshoots: true, fee: 100_000 }),
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

  it("applies to the scan origin too — the scan gets called on again", () => {
    const result = calculate(
      [credit({ id: "a", releaseDate: "2024-01-01", scanned: true, reshoots: true, fee: 100_000 })],
      NO_ADS,
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    expect(result.reshootTotal).toBe(2_000);
    expect(result.relicenceTotal).toBe(0);
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
        credit({ id: "later", releaseDate: "2024-01-01", reshoots: true, fee: 100_000 }),
      ],
      { engagementsPerYear: 1, averageFee: 10_000 },
      DEFAULT_ASSUMPTIONS,
      NOW,
    );

    // 5% of 100k re-licence + 2% of 100k reshoot + 3 years of cover x 10k ads
    expect(result.relicenceTotal).toBe(5_000);
    expect(result.reshootTotal).toBe(2_000);
    expect(result.advertisingTotal).toBe(30_000);
    expect(result.total).toBe(37_000);
    expect(result.feeTotal).toBe(200_000);
    expect(result.upliftPercent).toBe(18.5);
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
        credit({ id: "later", releaseDate: "2022-01-01", fee: 100_000 }),
      ],
      NO_ADS,
      { ...DEFAULT_ASSUMPTIONS, scanCycleYears: 5, relicenceRate: 0.1 },
      NOW,
    );

    // The 5-year cycle now reaches 2022, and the rate is 10%.
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
