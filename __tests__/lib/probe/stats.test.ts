import { describe, it, expect } from "vitest";
import { buildVerdict, fisherExactTwoTailed } from "@/lib/probe/stats";
import type { ScoredSample } from "@/lib/probe/types";

describe("fisherExactTwoTailed", () => {
  it("matches the classic tea-tasting 3/3 vs 0/3 table", () => {
    // [[3,0],[0,3]] two-tailed p = 0.1 (the canonical lady-tasting-tea result).
    const p = fisherExactTwoTailed(3, 0, 0, 3);
    expect(p).toBeCloseTo(0.1, 3);
  });

  it("returns 1 when a margin is empty (no evidence either way)", () => {
    expect(fisherExactTwoTailed(0, 0, 5, 5)).toBe(1);
    expect(fisherExactTwoTailed(0, 5, 0, 5)).toBe(1);
  });

  it("gives a small p for a strong, well-separated signal", () => {
    // 20/20 target matches vs 0/20 control — should be highly significant.
    const p = fisherExactTwoTailed(20, 0, 0, 20);
    expect(p).toBeLessThan(1e-6);
  });

  it("is symmetric to swapping the two rows", () => {
    const a = fisherExactTwoTailed(7, 3, 2, 8);
    const b = fisherExactTwoTailed(2, 8, 7, 3);
    expect(a).toBeCloseTo(b, 12);
  });
});

function sample(
  condition: ScoredSample["condition"],
  sim: number | null,
  phash: number | null = null
): ScoredSample {
  return { condition, rekognitionSimilarity: sim, phashMinDistance: phash };
}

describe("buildVerdict", () => {
  const opts = { matchThreshold: 0.85, phashDerivationThreshold: 16 };

  it("classifies a strong, separated signal as strong encoding", () => {
    const samples: ScoredSample[] = [
      ...Array.from({ length: 12 }, () => sample("target", 0.95)),
      ...Array.from({ length: 12 }, () => sample("control_distractor", 0.2)),
      ...Array.from({ length: 6 }, () => sample("control_baseline", 0.1)),
    ];
    const v = buildVerdict({ samples, ...opts });
    expect(v.targetMatchRate).toBe(1);
    expect(v.controlMatchRate).toBe(0);
    expect(v.rateDifference).toBe(1);
    expect(v.fisherP).toBeLessThan(0.05);
    expect(v.encoding).toBe("strong");
    expect(v.scanMembershipSignal).toBe(false);
  });

  it("reports no encoding when target and controls look alike", () => {
    const samples: ScoredSample[] = [
      ...Array.from({ length: 12 }, () => sample("target", 0.2)),
      ...Array.from({ length: 12 }, () => sample("control_distractor", 0.2)),
      ...Array.from({ length: 6 }, () => sample("control_baseline", 0.2)),
    ];
    const v = buildVerdict({ samples, ...opts });
    expect(v.targetMatchRate).toBe(0);
    expect(v.encoding).toBe("none");
  });

  it("raises the scan-membership signal on any pHash regurgitation", () => {
    const samples: ScoredSample[] = [
      sample("target", 0.95, 4), // <= threshold: regurgitation
      sample("target", 0.9, 40),
      sample("control_distractor", 0.1, 50),
    ];
    const v = buildVerdict({ samples, ...opts });
    expect(v.phashRegurgitations).toBe(1);
    expect(v.scanMembershipSignal).toBe(true);
  });

  it("treats null similarities as not-measured, not as zero", () => {
    const samples: ScoredSample[] = [
      sample("target", null),
      sample("target", 0.95),
      sample("control_distractor", null),
    ];
    const v = buildVerdict({ samples, ...opts });
    const target = v.conditions.find((c) => c.condition === "target")!;
    expect(target.scored).toBe(1); // only the measured one counts
    expect(target.matchRate).toBe(1);
  });
});
