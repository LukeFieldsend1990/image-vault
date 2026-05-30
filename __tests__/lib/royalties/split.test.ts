import { describe, it, expect } from "vitest";
import { computeRoyalty, DEFAULT_SPLIT } from "@/lib/royalties/split";

describe("computeRoyalty", () => {
  it("computes gross as units × unit rate", () => {
    const s = computeRoyalty(240, 50); // 240 frames @ 50p
    expect(s.grossPence).toBe(12000);
  });

  it("splits 65/20/15 by default with no rounding leakage", () => {
    const s = computeRoyalty(100, 100); // gross = 10000
    expect(s.talentPence).toBe(6500);
    expect(s.agencyPence).toBe(2000);
    expect(s.platformPence).toBe(1500);
    expect(s.talentPence + s.agencyPence + s.platformPence).toBe(s.grossPence);
  });

  it("platform absorbs rounding remainder so the split always reconciles", () => {
    const s = computeRoyalty(1, 1); // gross = 1p, indivisible
    expect(s.talentPence).toBe(0); // floor(1 * 65/100)
    expect(s.agencyPence).toBe(0); // floor(1 * 20/100)
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

  it("exposes the 0013 defaults", () => {
    expect(DEFAULT_SPLIT).toEqual({ talentSharePct: 65, agencySharePct: 20, platformSharePct: 15 });
  });
});
