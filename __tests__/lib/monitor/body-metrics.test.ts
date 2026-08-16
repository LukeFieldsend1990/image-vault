import { describe, it, expect } from "vitest";

// The derivation is worker-side code; vitest resolves it by relative path
// (the worker duplicates schema, not logic — this module is the single
// implementation).
import { deriveBodyMetrics } from "../../../pipeline-worker/src/body-metrics";
import { buildBodyBuildSummary, parseBodyMetrics } from "@/lib/monitor/body-profile";

/** Width histogram (slice 0 = feet) for a stylised standing figure. */
function figureWidths(slices: number, opts: { shoulder: number; hip: number; waist: number; legs: number }): number[] {
  const widths: number[] = [];
  for (let i = 0; i < slices; i++) {
    const frac = i / slices;
    if (frac < 0.45) widths.push(opts.legs);
    else if (frac < 0.58) widths.push(opts.hip);
    else if (frac < 0.78) widths.push(opts.waist);
    else if (frac < 0.9) widths.push(opts.shoulder);
    else widths.push(opts.shoulder * 0.45); // head
  }
  return widths;
}

describe("deriveBodyMetrics", () => {
  it("reads shoulder, hip and waist bands from a standing figure", () => {
    const widths = figureWidths(64, { shoulder: 0.45, hip: 0.3, waist: 0.24, legs: 0.28 });
    const metrics = deriveBodyMetrics(widths, 1.8);
    expect(metrics).not.toBeNull();
    expect(metrics!.shoulderToHip).toBeCloseTo(1.5, 1);
    expect(metrics!.shoulderWidthRatio).toBeCloseTo(0.45 / 1.8, 2);
    expect(metrics!.hipWidthRatio).toBeCloseTo(0.3 / 1.8, 2);
    expect(metrics!.waistWidthRatio).toBeCloseTo(0.24 / 1.8, 2);
    expect(metrics!.hipHeightRatio).toBeGreaterThan(0.4);
    expect(metrics!.hipHeightRatio).toBeLessThan(0.6);
  });

  it("refuses degenerate inputs", () => {
    expect(deriveBodyMetrics([], 1.8)).toBeNull();
    expect(deriveBodyMetrics(new Array(64).fill(0), 1.8)).toBeNull();
    expect(deriveBodyMetrics(figureWidths(64, { shoulder: 1, hip: 1, waist: 1, legs: 1 }), 0)).toBeNull();
  });

  it("a cylinder yields a neutral shoulder-to-hip ratio", () => {
    const metrics = deriveBodyMetrics(new Array(64).fill(0.4), 1.8);
    expect(metrics).not.toBeNull();
    expect(metrics!.shoulderToHip).toBeCloseTo(1.0, 5);
  });
});

describe("body-profile summariser", () => {
  it("round-trips metrics JSON into a one-line summary", () => {
    const widths = figureWidths(64, { shoulder: 0.45, hip: 0.3, waist: 0.24, legs: 0.28 });
    const metrics = deriveBodyMetrics(widths, 1.8)!;
    const parsed = parseBodyMetrics(JSON.stringify(metrics));
    expect(parsed).not.toBeNull();
    const summary = buildBodyBuildSummary(parsed!);
    expect(summary).toMatch(/broad-shouldered/);
    expect(summary).toMatch(/shoulder-to-hip ratio/);
  });

  it("rejects malformed metrics JSON", () => {
    expect(parseBodyMetrics("not json")).toBeNull();
    expect(parseBodyMetrics(JSON.stringify({ heightUnits: 1.8 }))).toBeNull();
  });
});
