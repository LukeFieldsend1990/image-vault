/**
 * Probe statistics — pure, deterministic, no I/O.
 *
 * The job here is to turn a bag of scored samples into a defensible verdict.
 * The load-bearing idea is comparison, not an absolute number: a face-similarity
 * score means nothing on its own (the scorer is a vendor black box), but the
 * *difference* between the target condition and identically-generated controls
 * is interpretable — it is the scorer's own false-positive rate, measured under
 * the same conditions, subtracted out.
 *
 * We report:
 *   • per-condition match rates and similarity summaries
 *   • a two-tailed Fisher's exact p-value (target matches vs pooled control
 *     matches) — exact because sample counts are small
 *   • the rate difference as the effect size
 *   • whether any generated image regurgitated a vault still (pHash) — the one
 *     channel that speaks to training on the scans specifically
 */

import type { ConditionSummary, ProbeConditionKind, ProbeVerdict, ScoredSample } from "./types";

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function summariseCondition(
  condition: ProbeConditionKind,
  samples: ScoredSample[],
  matchThreshold: number,
  phashThreshold: number
): ConditionSummary {
  const sims = samples
    .map((s) => s.rekognitionSimilarity)
    .filter((v): v is number => typeof v === "number");
  const scored = sims.length;
  const matches = sims.filter((v) => v >= matchThreshold).length;
  const phashMatches = samples.filter(
    (s) => typeof s.phashMinDistance === "number" && s.phashMinDistance <= phashThreshold
  ).length;
  return {
    condition,
    scored,
    matchRate: scored ? matches / scored : 0,
    meanSimilarity: mean(sims),
    maxSimilarity: sims.length ? Math.max(...sims) : null,
    phashMatches,
  };
}

// ── Fisher's exact test (2×2, two-tailed) ────────────────────────────────────

/** ln(n!) via a small lookup extended by ln-gamma; exact enough for our N. */
function lnFactorial(n: number): number {
  let acc = 0;
  for (let i = 2; i <= n; i++) acc += Math.log(i);
  return acc;
}

/** Hypergeometric probability of exactly `a` in the top-left cell of the 2×2
 *  table [[a,b],[c,d]] with fixed margins. */
function hypergeomProb(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  const logP =
    lnFactorial(a + b) +
    lnFactorial(c + d) +
    lnFactorial(a + c) +
    lnFactorial(b + d) -
    lnFactorial(a) -
    lnFactorial(b) -
    lnFactorial(c) -
    lnFactorial(d) -
    lnFactorial(n);
  return Math.exp(logP);
}

/**
 * Two-tailed Fisher's exact p-value for the table:
 *   [[targetMatches, targetMisses], [controlMatches, controlMisses]]
 *
 * Two-tailed by the standard "sum of all tables at most as probable as the
 * observed one" definition. Returns 1 when either margin is empty (no evidence
 * either way) rather than dividing by zero.
 */
export function fisherExactTwoTailed(
  targetMatches: number,
  targetMisses: number,
  controlMatches: number,
  controlMisses: number
): number {
  const rowT = targetMatches + targetMisses;
  const rowC = controlMatches + controlMisses;
  const colM = targetMatches + controlMatches;
  const n = rowT + rowC;
  if (rowT === 0 || rowC === 0 || colM === 0 || colM === n) return 1;

  const pObserved = hypergeomProb(targetMatches, targetMisses, controlMatches, controlMisses);

  // `a` (top-left) ranges over its feasible values given fixed margins.
  const aMin = Math.max(0, colM - rowC);
  const aMax = Math.min(rowT, colM);
  let p = 0;
  // A tiny epsilon guards against summing tables that are equal to the observed
  // one but differ by floating-point dust.
  const eps = 1e-9;
  for (let a = aMin; a <= aMax; a++) {
    const b = rowT - a;
    const c = colM - a;
    const d = rowC - c;
    const prob = hypergeomProb(a, b, c, d);
    if (prob <= pObserved * (1 + eps)) p += prob;
  }
  return Math.min(1, p);
}

function classifyEncoding(
  rateDifference: number,
  fisherP: number,
  targetMatchRate: number
): ProbeVerdict["encoding"] {
  // Strong: a clear, statistically separated target signal well above controls.
  if (targetMatchRate >= 0.6 && rateDifference >= 0.4 && fisherP < 0.05) return "strong";
  if (targetMatchRate >= 0.3 && rateDifference >= 0.2 && fisherP < 0.1) return "moderate";
  if (rateDifference > 0 && targetMatchRate > 0) return "weak";
  return "none";
}

export interface BuildVerdictInput {
  samples: ScoredSample[];
  matchThreshold: number;
  phashDerivationThreshold: number;
}

/** Reduce scored samples to the verdict written to the report. Pure. */
export function buildVerdict(input: BuildVerdictInput): ProbeVerdict {
  const { matchThreshold, phashDerivationThreshold } = input;
  const byCondition = (c: ProbeConditionKind) => input.samples.filter((s) => s.condition === c);

  const conditions: ConditionSummary[] = [
    summariseCondition("target", byCondition("target"), matchThreshold, phashDerivationThreshold),
    summariseCondition(
      "control_distractor",
      byCondition("control_distractor"),
      matchThreshold,
      phashDerivationThreshold
    ),
    summariseCondition(
      "control_baseline",
      byCondition("control_baseline"),
      matchThreshold,
      phashDerivationThreshold
    ),
  ];

  const target = conditions[0];
  // Pool both controls: together they estimate "what the scorer says when the
  // face is NOT the target under these exact generation conditions".
  const controlSamples = [...byCondition("control_distractor"), ...byCondition("control_baseline")];
  const control = summariseCondition(
    "control_distractor",
    controlSamples,
    matchThreshold,
    phashDerivationThreshold
  );

  const targetMatches = Math.round(target.matchRate * target.scored);
  const targetMisses = target.scored - targetMatches;
  const controlMatches = Math.round(control.matchRate * control.scored);
  const controlMisses = control.scored - controlMatches;

  const fisherP = fisherExactTwoTailed(
    targetMatches,
    targetMisses,
    controlMatches,
    controlMisses
  );
  const rateDifference = target.matchRate - control.matchRate;
  const phashRegurgitations = conditions.reduce((sum, c) => sum + c.phashMatches, 0);

  return {
    matchThreshold,
    phashDerivationThreshold,
    conditions,
    targetMatchRate: target.matchRate,
    controlMatchRate: control.matchRate,
    fisherP,
    rateDifference,
    phashRegurgitations,
    encoding: classifyEncoding(rateDifference, fisherP, target.matchRate),
    scanMembershipSignal: phashRegurgitations > 0,
  };
}
