import { describe, it, expect } from "vitest";
import {
  buildProtocol,
  estimateProbeCostUsd,
  DEFAULT_SEEDS,
  DEFAULT_PROMPT_TEMPLATES,
  DEFAULT_DISTRACTOR_NAMES,
} from "@/lib/probe/protocol";

describe("buildProtocol", () => {
  it("is deterministic — same input yields identical plan and ids", () => {
    const a = buildProtocol({ subjectPhrase: "Jane Doe" });
    const b = buildProtocol({ subjectPhrase: "Jane Doe" });
    expect(a).toEqual(b);
    // ids are positional, so they're stable across runs (replayable).
    expect(a.samples[0].id).toBe("t-0-0");
  });

  it("counts samples correctly across the three conditions", () => {
    const p = buildProtocol({ subjectPhrase: "Jane Doe" });
    const T = DEFAULT_PROMPT_TEMPLATES.length * DEFAULT_SEEDS.length;
    const D = DEFAULT_DISTRACTOR_NAMES.length * DEFAULT_SEEDS.length;
    const B = DEFAULT_SEEDS.length;
    expect(p.counts).toEqual({ target: T, controlDistractor: D, controlBaseline: B, total: T + D + B });
    expect(p.samples).toHaveLength(T + D + B);
    expect(p.samples.filter((s) => s.condition === "target")).toHaveLength(T);
    expect(p.samples.filter((s) => s.condition === "control_distractor")).toHaveLength(D);
    expect(p.samples.filter((s) => s.condition === "control_baseline")).toHaveLength(B);
  });

  it("runs the SAME seeds in every condition (controls are matched)", () => {
    const p = buildProtocol({ subjectPhrase: "Jane Doe" });
    for (const cond of ["target", "control_distractor", "control_baseline"] as const) {
      const seeds = new Set(p.samples.filter((s) => s.condition === cond).map((s) => s.seed));
      for (const seed of DEFAULT_SEEDS) expect(seeds.has(seed)).toBe(true);
    }
  });

  it("folds trigger words into the target prompt but not the controls", () => {
    const p = buildProtocol({ subjectPhrase: "Jane Doe", trainedWords: ["j4ned0e"] });
    const target = p.samples.find((s) => s.condition === "target")!;
    expect(target.prompt).toContain("Jane Doe");
    expect(target.prompt).toContain("j4ned0e");
    const distractor = p.samples.find((s) => s.condition === "control_distractor")!;
    expect(distractor.prompt).not.toContain("j4ned0e");
    expect(distractor.prompt).not.toContain("Jane Doe");
  });

  it("never leaks the {subject} placeholder into a generated prompt", () => {
    const p = buildProtocol({ subjectPhrase: "Jane Doe" });
    for (const s of p.samples) expect(s.prompt).not.toContain("{subject}");
  });

  it("estimates cost as an over-estimate of generation + scoring", () => {
    const p = buildProtocol({ subjectPhrase: "Jane Doe" });
    const cost = estimateProbeCostUsd(p, { perImageUsd: 0.03, referenceCount: 3, perComparisonUsd: 0.001 });
    // total images × 0.03 + total × 3 × 0.001
    const expected =
      Math.round((p.counts.total * 0.03 + p.counts.total * 3 * 0.001) * 100) / 100;
    expect(cost).toBeCloseTo(expected, 2);
    expect(cost).toBeGreaterThan(0);
  });
});
