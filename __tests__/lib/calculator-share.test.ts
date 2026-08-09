import { describe, it, expect } from "vitest";
import {
  buildShareUrl,
  decodeShareState,
  encodeShareState,
  SHARE_PARAM,
  type ShareCredit,
  type ShareState,
} from "@/lib/calculator/share";
import { DEFAULT_ASSUMPTIONS } from "@/lib/calculator/model";

function shareCredit(over: Partial<ShareCredit> & { id: string }): ShareCredit {
  return { fee: 0, scanned: false, reshoots: false, dropped: false, ...over };
}

function state(over: Partial<ShareState> = {}): ShareState {
  return {
    personId: 12345,
    currency: "GBP",
    credits: [],
    advertising: { engagementsPerYear: 0, averageFee: 0 },
    assumptions: DEFAULT_ASSUMPTIONS,
    ...over,
  };
}

describe("share codec — round trip", () => {
  it("restores a fully marked-up sheet", () => {
    const original = state({
      personId: 1245,
      currency: "USD",
      advertising: { engagementsPerYear: 3, averageFee: 18_000 },
      credits: [
        shareCredit({ id: "movie-550", fee: 120_000, scanned: true }),
        shareCredit({ id: "movie-551", fee: 120_000, reshoots: true }),
        shareCredit({ id: "tv-1396", fee: 90_000, scanned: true, reshoots: true }),
        shareCredit({ id: "movie-552", fee: 120_000, dropped: true }),
      ],
    });

    const decoded = decodeShareState(encodeShareState(original));

    expect(decoded).toEqual(original);
  });

  it("restores non-default assumptions", () => {
    const original = state({
      assumptions: { scanCycleYears: 5, relicenceRate: 0.075, reshootRate: 0.015, lookbackYears: 15 },
      credits: [shareCredit({ id: "movie-1", fee: 1_000, scanned: true })],
    });

    expect(decodeShareState(encodeShareState(original))?.assumptions).toEqual(original.assumptions);
  });

  it("keeps default assumptions out of the payload but restores them", () => {
    const encoded = encodeShareState(state({ credits: [shareCredit({ id: "movie-1", scanned: true })] }));

    // The assumptions section is the sixth of seven, and is empty.
    expect(encoded.split("*")[5]).toBe("");
    expect(decodeShareState(encoded)?.assumptions).toEqual(DEFAULT_ASSUMPTIONS);
  });

  it("survives a real URL round trip without escaping", () => {
    const original = state({
      personId: 8_000_000,
      currency: "EUR",
      advertising: { engagementsPerYear: 12, averageFee: 250_000 },
      credits: [
        shareCredit({ id: "movie-999999", fee: 1_500_000, scanned: true, reshoots: true }),
        shareCredit({ id: "tv-42", fee: 750, dropped: true }),
      ],
    });

    const url = buildShareUrl("https://imagevault.ai", original);
    const payload = new URL(url).searchParams.get(SHARE_PARAM);

    // No percent-encoding: every character is URL-safe and QR-alphanumeric.
    expect(url).not.toContain("%");
    expect(payload).toMatch(/^[0-9A-Z*.\-]+$/);
    expect(decodeShareState(payload)).toEqual(original);
  });
});

describe("share codec — payload size", () => {
  it("costs nothing per row when every credit shares one fee", () => {
    const credits = Array.from({ length: 20 }, (_, i) =>
      shareCredit({ id: `movie-${100_000 + i}`, fee: 120_000, scanned: i % 4 === 0 }),
    );

    const encoded = encodeShareState(state({ credits }));

    // The hoisted fee means each row is a flag, a marker and a base36 id.
    expect(encoded.length).toBeLessThan(200);
    expect(decodeShareState(encoded)?.credits).toHaveLength(20);
  });

  it("stays scannable when every credit has a different fee", () => {
    const credits = Array.from({ length: 20 }, (_, i) =>
      shareCredit({ id: `movie-${100_000 + i}`, fee: 50_000 + i * 1_000, scanned: i % 3 === 0 }),
    );

    expect(encodeShareState(state({ credits })).length).toBeLessThan(320);
  });

  it("drops credits that carry no information", () => {
    const encoded = encodeShareState(
      state({
        credits: [
          shareCredit({ id: "movie-1" }),
          shareCredit({ id: "movie-2" }),
          shareCredit({ id: "movie-3", scanned: true }),
        ],
      }),
    );

    expect(decodeShareState(encoded)?.credits).toEqual([
      shareCredit({ id: "movie-3", scanned: true }),
    ]);
  });

  it("keeps a removed credit even though it has no fee", () => {
    const encoded = encodeShareState(
      state({ credits: [shareCredit({ id: "tv-7", dropped: true })] }),
    );

    expect(decodeShareState(encoded)?.credits).toEqual([shareCredit({ id: "tv-7", dropped: true })]);
  });
});

describe("share codec — untrusted input", () => {
  it("returns null for junk rather than throwing", () => {
    for (const junk of [
      null,
      undefined,
      "",
      "nonsense",
      "2*ABC*0*0*0.0**",           // future version
      "1*0*0*0*0.0**",             // person id of zero
      "1*ZZZ",                     // truncated
      "1**0*0*0.0**",              // missing person id
      "1*!!!*0*0*0.0**",           // person id isn't base36
    ]) {
      expect(() => decodeShareState(junk)).not.toThrow();
      expect(decodeShareState(junk)).toBeNull();
    }
  });

  it("drops a mangled row instead of the whole sheet", () => {
    const good = encodeShareState(
      state({
        credits: [
          shareCredit({ id: "movie-1", fee: 100, scanned: true }),
          shareCredit({ id: "movie-2", fee: 100, scanned: true }),
        ],
      }),
    );
    const mangled = good.replace("1M2", "9X!");

    const decoded = decodeShareState(mangled);
    expect(decoded?.credits).toHaveLength(1);
    expect(decoded?.credits[0].id).toBe("movie-1");
  });

  it("clamps out-of-range assumptions from a hand-edited link", () => {
    // Cycle 9999 years, 500% re-licence, 900-year lookback.
    const decoded = decodeShareState("1*9IX*0*0*0.0*7PR.5K.5K.OF*");

    expect(decoded?.assumptions.scanCycleYears).toBeLessThanOrEqual(50);
    expect(decoded?.assumptions.relicenceRate).toBeLessThanOrEqual(1);
    expect(decoded?.assumptions.reshootRate).toBeLessThanOrEqual(1);
    expect(decoded?.assumptions.lookbackYears).toBeLessThanOrEqual(25);
  });

  it("ignores an unknown currency index", () => {
    const encoded = encodeShareState(state()).replace("*0*", "*99*");
    expect(decodeShareState(encoded)?.currency).toBe("GBP");
  });

  it("de-duplicates repeated credit ids", () => {
    const decoded = decodeShareState("1*9IX*0*3E8*0.0**1M1-1M1-1M1");
    expect(decoded?.credits).toHaveLength(1);
  });

  it("caps the number of credits it will accept", () => {
    const rows = Array.from({ length: 400 }, (_, i) => `1M${(i + 1).toString(36).toUpperCase()}`);
    const decoded = decodeShareState(`1*9IX*0*3E8*0.0**${rows.join("-")}`);
    expect(decoded!.credits.length).toBeLessThanOrEqual(200);
  });

  it("rejects a negative fee smuggled in as a signed value", () => {
    const decoded = decodeShareState("1*9IX*0*0*0.0**1M1.-5");
    expect(decoded?.credits).toEqual([]);
  });
});

describe("share codec — fee hoisting", () => {
  it("hoists the most common fee and writes the outliers inline", () => {
    const original = state({
      credits: [
        shareCredit({ id: "movie-1", fee: 100_000, scanned: true }),
        shareCredit({ id: "movie-2", fee: 100_000, scanned: true }),
        shareCredit({ id: "movie-3", fee: 100_000, scanned: true }),
        shareCredit({ id: "movie-4", fee: 40_000, scanned: true }),
      ],
    });

    const encoded = encodeShareState(original);
    const rows = encoded.split("*")[6].split("-");

    expect(rows.filter((r) => r.includes("."))).toHaveLength(1); // only the outlier
    expect(decodeShareState(encoded)).toEqual(original);
  });

  it("round-trips a zero fee on a marked credit when others carry fees", () => {
    const original = state({
      credits: [
        shareCredit({ id: "movie-1", fee: 80_000, scanned: true }),
        shareCredit({ id: "movie-2", fee: 80_000 }),
        shareCredit({ id: "movie-3", fee: 0, scanned: true }),
      ],
    });

    expect(decodeShareState(encodeShareState(original))).toEqual(original);
  });

  it("rounds fractional fees rather than losing the row", () => {
    const decoded = decodeShareState(
      encodeShareState(state({ credits: [shareCredit({ id: "movie-1", fee: 1234.56, scanned: true })] })),
    );

    expect(decoded?.credits[0].fee).toBe(1235);
  });
});
