/**
 * Body-geometry context for the adjudicator prompt.
 *
 * Reads the talent's body profile (computed by the pipeline worker's
 * width-profile pass over their full-body scan mesh) and renders it as one
 * short human sentence. This is CONTEXT, not a signal: the profile proves
 * only that the talent's scan has these proportions — nothing about any
 * candidate. It must never appear in `CandidateSignals`, never flag, and
 * never raise confidence. Gated behind the `body_context_enabled`
 * ai_settings key, default off.
 */

export interface BodyProfileMetrics {
  heightUnits: number;
  shoulderWidthRatio: number;
  hipWidthRatio: number;
  waistWidthRatio: number;
  shoulderToHip: number;
  hipHeightRatio: number;
  sliceCount: number;
}

export function parseBodyMetrics(metricsJson: string): BodyProfileMetrics | null {
  try {
    const parsed = JSON.parse(metricsJson) as Partial<BodyProfileMetrics>;
    if (
      typeof parsed.shoulderToHip !== "number" ||
      typeof parsed.shoulderWidthRatio !== "number" ||
      typeof parsed.hipWidthRatio !== "number"
    ) {
      return null;
    }
    return parsed as BodyProfileMetrics;
  } catch {
    return null;
  }
}

/**
 * One sentence of build context, in plain terms the adjudicator can weigh
 * against a full-body candidate ("broad-shouldered" vs "a slight frame").
 */
export function buildBodyBuildSummary(metrics: BodyProfileMetrics): string {
  const ratio = metrics.shoulderToHip;
  const build =
    ratio >= 1.45 ? "broad-shouldered" : ratio >= 1.15 ? "average-proportioned" : "slighter-framed";
  const parts = [`${build} build`, `shoulder-to-hip ratio ≈ ${ratio.toFixed(2)}`];
  if (typeof metrics.hipHeightRatio === "number" && metrics.hipHeightRatio > 0) {
    parts.push(`hip line ≈ ${Math.round(metrics.hipHeightRatio * 100)}% of stature`);
  }
  return parts.join(", ");
}
