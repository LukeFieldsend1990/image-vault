/**
 * The pre-registered probe design — pure and deterministic.
 *
 * "Pre-registered" is the whole point: the prompts, the seeds, the control
 * cohort and the thresholds are fixed *before* any image is generated and
 * frozen into the run manifest, so nobody can be accused of fishing for a
 * result. Same inputs → identical plan, which is why this module takes no
 * randomness of its own: seeds are derived from a caller-supplied base, and the
 * sample ids are positional. A run can therefore be replayed byte-for-byte from
 * its stored protocol.
 *
 * The design has three conditions, and the two controls are not decoration —
 * they are what turns a raw similarity number into evidence:
 *   • target             — the actor's name / the model's own trigger words
 *   • control_distractor — matched fictitious names, same prompts + seeds; this
 *                          measures the scorer's false-positive rate under
 *                          identical generation conditions
 *   • control_baseline   — descriptors only, no name; this catches a LoRA that
 *                          collapses *every* face to the actor (which would make
 *                          the distractor control read falsely high)
 */

import type { ProbePlanSample, ProbeProtocol } from "./types";

export const PROTOCOL_VERSION = "probe-protocol-v1";

/** Rekognition similarity (0-1) at/above which a sample counts as a match.
 *  Mirrors REKOGNITION_CONFIRMED in lib/monitor/identity-check.ts. */
export const DEFAULT_MATCH_THRESHOLD = 0.85;

/** pHash Hamming distance at/under which a generated image reads as derived
 *  from vault imagery. Mirrors PHASH_DERIVATION_THRESHOLD in the monitor. */
export const DEFAULT_PHASH_DERIVATION_THRESHOLD = 16;

/** Neutral, photographic prompt templates. Kept plain and non-leading so the
 *  model — not the prompt — supplies the face. `{subject}` is substituted. */
export const DEFAULT_PROMPT_TEMPLATES = [
  "a candid photograph of {subject}, natural lighting, plain background",
  "a close-up portrait photo of {subject}, neutral expression, studio lighting",
  "a full-length photo of {subject} standing outdoors, daylight",
  "a photograph of {subject} at a press event, flash photography",
];

export const DEFAULT_NEGATIVE_PROMPT =
  "cartoon, illustration, painting, drawing, text, watermark, deformed, disfigured";

/** Six fixed seeds, run identically across every condition. */
export const DEFAULT_SEEDS = [1101, 2027, 3319, 4507, 5623, 6737];

/** Matched fictitious names for the distractor control. Deliberately plausible
 *  full names the base model has no specific person for. */
export const DEFAULT_DISTRACTOR_NAMES = ["Jordan Halloway", "Marta Feldstein", "Devin Osei"];

export const DEFAULT_BASELINE_DESCRIPTOR = "a person";

export interface BuildProtocolInput {
  /** The talent's real name — the identity the target condition asserts. */
  subjectPhrase: string;
  /** Trigger words the target model publishes (Civitai trainedWords), if any. */
  trainedWords?: string[];
  /** Override any knob; omitted fields fall back to the module defaults. */
  promptTemplates?: string[];
  negativePrompt?: string;
  seeds?: number[];
  distractorNames?: string[];
  baselineDescriptor?: string;
  matchThreshold?: number;
  phashDerivationThreshold?: number;
}

/** Fold trigger words into the subject phrase so the target prompt exercises
 *  the exact tokens the model was published with, not just the plain name. */
function targetSubject(subjectPhrase: string, trainedWords: string[]): string {
  const words = trainedWords.map((w) => w.trim()).filter(Boolean);
  if (!words.length) return subjectPhrase;
  return `${subjectPhrase} (${words.join(", ")})`;
}

/**
 * Build the full, ordered generation plan. Pure: the same input always yields
 * the same samples in the same order with the same ids, so the plan can be
 * frozen into the manifest and replayed.
 */
export function buildProtocol(input: BuildProtocolInput): ProbeProtocol {
  const subjectPhrase = input.subjectPhrase.trim();
  const trainedWords = (input.trainedWords ?? []).map((w) => w.trim()).filter(Boolean);
  const promptTemplates = input.promptTemplates ?? DEFAULT_PROMPT_TEMPLATES;
  const negativePrompt = input.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT;
  const seeds = input.seeds ?? DEFAULT_SEEDS;
  const distractorNames = input.distractorNames ?? DEFAULT_DISTRACTOR_NAMES;
  const baselineDescriptor = input.baselineDescriptor ?? DEFAULT_BASELINE_DESCRIPTOR;
  const matchThreshold = input.matchThreshold ?? DEFAULT_MATCH_THRESHOLD;
  const phashDerivationThreshold =
    input.phashDerivationThreshold ?? DEFAULT_PHASH_DERIVATION_THRESHOLD;

  const samples: ProbePlanSample[] = [];
  const target = targetSubject(subjectPhrase, trainedWords);

  // Target: every template × every seed.
  for (let ti = 0; ti < promptTemplates.length; ti++) {
    for (let si = 0; si < seeds.length; si++) {
      samples.push({
        id: `t-${ti}-${si}`,
        condition: "target",
        conditionLabel: null,
        prompt: promptTemplates[ti].replace("{subject}", target),
        negativePrompt,
        seed: seeds[si],
      });
    }
  }

  // Distractor control: each fictitious name, first template only, every seed —
  // enough samples to estimate a false-positive rate without matching the
  // target's sample count (the pooled controls are what we test against).
  for (let ni = 0; ni < distractorNames.length; ni++) {
    for (let si = 0; si < seeds.length; si++) {
      samples.push({
        id: `d-${ni}-${si}`,
        condition: "control_distractor",
        conditionLabel: distractorNames[ni],
        prompt: promptTemplates[0].replace("{subject}", distractorNames[ni]),
        negativePrompt,
        seed: seeds[si],
      });
    }
  }

  // Baseline control: descriptors only, first template, every seed.
  for (let si = 0; si < seeds.length; si++) {
    samples.push({
      id: `b-${si}`,
      condition: "control_baseline",
      conditionLabel: null,
      prompt: promptTemplates[0].replace("{subject}", baselineDescriptor),
      negativePrompt,
      seed: seeds[si],
    });
  }

  const counts = {
    target: promptTemplates.length * seeds.length,
    controlDistractor: distractorNames.length * seeds.length,
    controlBaseline: seeds.length,
    total: samples.length,
  };

  return {
    version: PROTOCOL_VERSION,
    subjectPhrase,
    trainedWords,
    promptTemplates,
    negativePrompt,
    seeds,
    distractorNames,
    baselineDescriptor,
    matchThreshold,
    phashDerivationThreshold,
    samples,
    counts,
  };
}

/**
 * Rough pre-run cost, in USD, so the admin sees a number before spending.
 * Deliberately an over-estimate (the pessimistic per-image rate + one face
 * compare per reference per sample) — a probe should never cost *more* than
 * quoted. Actual spend is recorded per call in probe_usage.
 */
export function estimateProbeCostUsd(
  protocol: ProbeProtocol,
  opts: { perImageUsd?: number; referenceCount?: number; perComparisonUsd?: number } = {}
): number {
  const perImage = opts.perImageUsd ?? 0.03; // pessimistic SDXL/Flux rate
  const perCompare = opts.perComparisonUsd ?? 0.001; // Rekognition CompareFaces
  const refs = Math.max(1, opts.referenceCount ?? 3);
  const images = protocol.counts.total;
  const generation = images * perImage;
  const scoring = images * refs * perCompare;
  return Math.round((generation + scoring) * 100) / 100;
}
