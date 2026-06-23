import { describe, it, expect } from "vitest";
import { computeRoyalty, DEFAULT_SPLIT } from "@/lib/royalties/split";

describe("computeRoyalty", () => {
  it("computes gross as units × unit rate", () => {
    const s = computeRoyalty(240, 50); // 240 frames @ 50p
    expect(s.grossPence).toBe(12000);
  });

  it("splits 80/10/10 by default with no rounding leakage", () => {
    const s = computeRoyalty(100, 100); // gross = 10000
    expect(s.talentPence).toBe(8000);
    expect(s.agencyPence).toBe(1000);
    expect(s.platformPence).toBe(1000);
    expect(s.talentPence + s.agencyPence + s.platformPence).toBe(s.grossPence);
  });

  it("platform absorbs rounding remainder so the split always reconciles", () => {
    const s = computeRoyalty(1, 1); // gross = 1p, indivisible
    expect(s.talentPence).toBe(0); // floor(1 * 80/100)
    expect(s.agencyPence).toBe(0); // floor(1 * 10/100)
    expect(s.platformPence).toBe(1); // remainder
    expect(s.talentPence + s.agencyPence + s.platformPence).toBe(1);
  });

  it("honours a custom split", () => {
    const s = computeRoyalty(10, 100, { talentSharePct: 90, agencySharePct: 5, platformSharePct: 5 });
    expect(s.grossPence).toBe(1000);
    expect(s.talentPence).toBe(900);
    expect(s.agencyPence).toBe(50);
    expect(s.platformPence).toBe(50);
  });

  it("clamps negative / fractional inputs", () => {
    const s = computeRoyalty(-5, 100);
    expect(s.grossPence).toBe(0);
    const f = computeRoyalty(2.9, 100.9);
    expect(f.grossPence).toBe(200); // floor(2) × floor(100)
  });

  it("exposes the default split", () => {
    expect(DEFAULT_SPLIT).toEqual({ talentSharePct: 80, agencySharePct: 10, platformSharePct: 10 });
  });
});
