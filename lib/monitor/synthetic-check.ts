/**
 * Synthetic-media detection: the first real producer of
 * `signals.syntheticMediaScore`, which has been null since Phase 1.
 *
 * Two stages, cheapest and most conclusive evidence first:
 *
 *  1. Provenance markers — a byte-scan for declared-AI metadata embedded in
 *     the file itself: the IPTC `trainedAlgorithmicMedia` digital-source
 *     type (what C2PA-compliant generators write) and generator signatures.
 *     Deterministic, free, and near-conclusive when present: the file is
 *     telling us it was generated. The big caveat is absence — social
 *     platforms re-encode media and strip metadata, so most thumbnails
 *     carry nothing. No markers is NOT evidence of authenticity, and the
 *     code never treats it that way.
 *
 *  2. Vision artifact check — LLaVA inspects the thumbnail for the tells of
 *     current-generation synthesis (malformed hands and text, waxy skin,
 *     impossible lighting, objects merging into each other). This is
 *     reasoning, not a trained forensic classifier, so "synthetic" maps to
 *     0.8 rather than the 0.95 a marker hit earns, and "unsure" maps to
 *     null — a refusal to guess, which the adjudicator reads as "no reading
 *     taken" and falls back to text-intent evidence.
 *
 * Both tells decay: generators close artifact gaps every release, and
 * watermark/metadata behaviour is a platform decision. This layer buys
 * coverage today; the durable signals (reference-anchored identity, pHash
 * derivation, geometry fingerprints) are documented in
 * docs/deepfake-detection.md.
 */

import { callVisionAi } from "@/lib/ai/providers";
import type { CandidateContent } from "./types";
import { fetchImageBytes } from "./identity-check";

/** Score assigned when the file's own metadata declares AI generation. */
export const MARKER_SCORE = 0.95;
/** Ceiling for a visual-artifact verdict — reasoning, not forensics. */
export const ARTIFACT_SCORE = 0.8;
/** Score when the vision model judges the image authentic. */
export const AUTHENTIC_SCORE = 0.15;

/**
 * Markers that mean the file declares itself AI-generated. The IPTC
 * digital-source-type value is the standards-track signal (C2PA-compliant
 * generators embed it); the rest are generator names as they appear in
 * XMP/EXIF software fields. All are long enough that a false hit in
 * compressed pixel data is vanishingly unlikely.
 */
const AI_DECLARED_MARKERS = [
  "trainedalgorithmicmedia", // IPTC digitalsourcetype — covers composites too
  "midjourney",
  "stable diffusion",
  "stablediffusion",
  "adobe firefly",
  "dall-e",
  "dall·e",
  "openai dall",
  "grok imagine",
  "runwayml",
  "ideogram.ai",
] as const;

/**
 * Markers that mean the file carries a provenance manifest — which is NOT
 * the same as being AI. Content credentials ship on authentic camera
 * captures too (Leica M11-P, Sony newsroom bodies), so these are recorded
 * for the audit trail but never scored as synthetic on their own.
 */
const PROVENANCE_MARKERS = ["urn:c2pa", "c2pa.org", "contentauthenticity", "jumbf"] as const;

export interface ProvenanceScan {
  /** Markers that declare AI generation — conclusive. */
  aiDeclared: string[];
  /** Provenance-manifest markers — informational only, never synthetic evidence. */
  provenance: string[];
}

/**
 * Case-insensitive substring scan over the raw bytes. Metadata blocks
 * (XMP, EXIF, JUMBF) are ASCII-embedded in every container we meet
 * (JPEG/PNG/WebP), so a latin1 decode finds them without parsing three
 * container formats. Capped input (5MB, enforced by fetchImageBytes) keeps
 * the decode cheap.
 */
export function scanProvenanceMarkers(bytes: Uint8Array): ProvenanceScan {
  const haystack = new TextDecoder("latin1").decode(bytes).toLowerCase();
  return {
    aiDeclared: AI_DECLARED_MARKERS.filter((m) => haystack.includes(m)),
    provenance: PROVENANCE_MARKERS.filter((m) => haystack.includes(m)),
  };
}

export type SyntheticVerdict = "synthetic" | "unsure" | "authentic";

/**
 * Parse the vision model's one-word answer, same discipline as the
 * identity check: scan for the first meaningful word, and refuse to
 * commit ("unsure") rather than fabricate a verdict from noise.
 */
export function parseSyntheticVerdict(text: string): SyntheticVerdict {
  const t = text.toLowerCase();
  if (/\b(synthetic|generated|ai-generated|fake|artificial)\b/.test(t)) return "synthetic";
  if (/\b(authentic|real|genuine|photograph|natural)\b/.test(t)) return "authentic";
  return "unsure";
}

export interface SyntheticCheckResult {
  /** Null when the check ran but refused to commit (verdict "unsure"). */
  score: number | null;
  verdict: SyntheticVerdict;
  /** Which stage produced the reading. */
  evidence: "provenance_marker" | "artifact_check";
  /** Marker names or the model's raw answer, for logging. */
  detail: string;
}

const ARTIFACT_PROMPT =
  "Examine this image for signs of AI generation: malformed hands, fingers or teeth; " +
  "garbled or nonsensical text; waxy over-smooth skin; inconsistent lighting or shadows; " +
  "warped backgrounds or objects merging into each other. " +
  "Answer with exactly one word: synthetic, unsure, or authentic. Do not explain.";

/**
 * Score one image. Returns null when no reading could be taken at all
 * (vision model errored and no markers present) — distinct from an
 * "unsure" result, which is a reading that declined to commit.
 */
export async function checkSyntheticMedia(
  ai: Ai,
  imageBytes: Uint8Array
): Promise<SyntheticCheckResult | null> {
  const markers = scanProvenanceMarkers(imageBytes);
  if (markers.aiDeclared.length) {
    return {
      score: MARKER_SCORE,
      verdict: "synthetic",
      evidence: "provenance_marker",
      detail: markers.aiDeclared.join(", "),
    };
  }

  let raw: string;
  try {
    const out = await callVisionAi(ai, { imageBytes, prompt: ARTIFACT_PROMPT, maxTokens: 8 });
    raw = out.text?.trim() ?? "";
  } catch {
    return null;
  }
  if (!raw) return null;

  const verdict = parseSyntheticVerdict(raw);
  return {
    score: verdict === "synthetic" ? ARTIFACT_SCORE : verdict === "authentic" ? AUTHENTIC_SCORE : null,
    verdict,
    evidence: "artifact_check",
    detail: raw.slice(0, 120),
  };
}

/**
 * Run the synthetic check across every candidate with a thumbnail,
 * mutating `signals.syntheticMediaScore`. Same batch discipline as the
 * identity check (concurrency 3 — Workers AI on this account tier throws
 * 5xxs under higher parallel load).
 */
export async function assessCandidatesSynthetic(
  ai: Ai,
  candidates: CandidateContent[],
  opts: { concurrency?: number } = {}
): Promise<{
  checked: number;
  declared: number;
  synthetic: number;
  authentic: number;
  unsure: number;
  errors: number;
}> {
  const concurrency = opts.concurrency ?? 3;
  const stats = { checked: 0, declared: 0, synthetic: 0, authentic: 0, unsure: 0, errors: 0 };

  const withThumb = candidates.filter((c) => !!c.media?.thumbnailUrl);
  for (let i = 0; i < withThumb.length; i += concurrency) {
    const batch = withThumb.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (c) => {
        const url = c.media?.thumbnailUrl;
        if (!url) return;
        const bytes = await fetchImageBytes(url);
        if (!bytes) {
          stats.errors++;
          return;
        }
        const result = await checkSyntheticMedia(ai, bytes);
        if (!result) {
          stats.errors++;
          return;
        }
        stats.checked++;
        if (result.evidence === "provenance_marker") stats.declared++;
        stats[result.verdict]++;
        // "unsure" leaves the signal null on purpose — a reading that
        // declined to commit must not overwrite "not measured" with a
        // manufactured midpoint.
        if (result.score !== null) {
          c.signals.syntheticMediaScore = result.score;
        }
      })
    );
  }

  return stats;
}
