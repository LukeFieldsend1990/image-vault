/**
 * Model Probe Protocol — shared types.
 *
 * A probe run interrogates a generative model to test whether it encodes a
 * talent's likeness. The vocabulary here is deliberately small and every field
 * that appears on the sealed report is captured at run time, because the whole
 * value of the exercise is reproducibility: a third party must be able to read
 * the protocol, re-run it, and get the same shape of answer.
 *
 * What a run can and cannot prove lives in docs/training-attribution.md. The
 * types encode the honest boundary — e.g. `rekognitionSimilarity` is nullable
 * (null = not measured, never "no match"), matching the null-means-not-measured
 * invariant the likeness monitor already holds itself to.
 */

/** civitai_lora — a downloadable community model run by weights URL.
 *  hosted_model — a named foundation/hosted endpoint probed by name only. */
export type ProbeTargetKind = "civitai_lora" | "hosted_model";

export type ProbeConditionKind = "target" | "control_distractor" | "control_baseline";

export type ProbeStatus =
  | "queued"
  | "generating"
  | "scoring"
  | "summarising"
  | "complete"
  | "failed";

/** Identity of the artifact under test, locked at run creation. */
export interface ProbeTarget {
  kind: ProbeTargetKind;
  /** "modelId@versionId" for Civitai, or a hosted model slug. */
  ref: string;
  /** The provider's own SHA-256 of the weights file, where published. */
  fileSha256?: string | null;
  /** For civitai_lora: the download URL passed to the LoRA-runner. */
  weightsUrl?: string | null;
  /** Human label for the report header. */
  displayName?: string | null;
  meta?: {
    trainedWords?: string[];
    baseModel?: string | null;
    publishedAt?: string | null;
    downloadCount?: number | null;
  };
}

/** One planned generation: fully specifies how the image is produced. */
export interface ProbePlanSample {
  /** Stable within a run; becomes the probe_samples row id. */
  id: string;
  condition: ProbeConditionKind;
  /** e.g. the distractor name used, or null for target/baseline. */
  conditionLabel: string | null;
  prompt: string;
  negativePrompt: string;
  seed: number;
}

/** The complete pre-registered design, serialised into probe_runs.protocolJson
 *  and reproduced verbatim on the report so the run shows its work. */
export interface ProbeProtocol {
  version: string;
  /** The talent name / trigger phrase the target condition asserts. */
  subjectPhrase: string;
  /** The trigger words the target model publishes, folded into target prompts. */
  trainedWords: string[];
  /** Neutral photographic prompt templates ({subject} is substituted). */
  promptTemplates: string[];
  negativePrompt: string;
  /** Fixed seeds — the same seeds run in every condition. */
  seeds: number[];
  /** Matched fictitious names for the distractor control. */
  distractorNames: string[];
  /** Descriptor-only phrase for the no-name baseline. */
  baselineDescriptor: string;
  /** Rekognition similarity at/above which a sample counts as a match. */
  matchThreshold: number;
  /** pHash Hamming distance at/under which a sample reads as regurgitation. */
  phashDerivationThreshold: number;
  /** The full generation plan, in execution order. */
  samples: ProbePlanSample[];
  counts: {
    target: number;
    controlDistractor: number;
    controlBaseline: number;
    total: number;
  };
}

/** Per-condition scoring roll-up. */
export interface ConditionSummary {
  condition: ProbeConditionKind;
  scored: number;
  /** Fraction (0-1) of scored samples at/above the match threshold. */
  matchRate: number;
  meanSimilarity: number | null;
  maxSimilarity: number | null;
  /** Samples whose generated image pHash-matched a vault still. */
  phashMatches: number;
}

/** The statistical verdict written to probe_runs.verdictJson and the report. */
export interface ProbeVerdict {
  matchThreshold: number;
  phashDerivationThreshold: number;
  conditions: ConditionSummary[];
  /** target vs pooled controls. */
  targetMatchRate: number;
  controlMatchRate: number;
  /** Two-tailed Fisher's exact p-value, target-match vs control-match. */
  fisherP: number;
  /** Rate difference, target minus pooled control (the effect size we report). */
  rateDifference: number;
  /** Total generated samples that regurgitated a vault still (any condition). */
  phashRegurgitations: number;
  /** Plain-language classification of the identity-encoding evidence. */
  encoding: "strong" | "moderate" | "weak" | "none";
  /** True only when a generated sample pHash-matched a vault still. */
  scanMembershipSignal: boolean;
}

/** A scored sample as the stats + report layers consume it (DB-shape-agnostic). */
export interface ScoredSample {
  condition: ProbeConditionKind;
  rekognitionSimilarity: number | null;
  phashMinDistance: number | null;
}
