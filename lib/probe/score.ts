/**
 * Scoring a generated sample against the vault.
 *
 * Two independent channels, mirroring the monitor's own separation of concerns:
 *   • identity — AWS Rekognition CompareFaces against the talent's probe-grade
 *     reference set (reuses lib/monitor/rekognition.ts and the R2 presign path
 *     from reference-set.ts). Returns a real 0-1 similarity, or null when no
 *     face is found — null means "not measured", never "no match".
 *   • derivation — the generated image's dHash against the talent's derivation
 *     index (reuses lib/monitor/phash + phash-index). A Hamming distance ≤ the
 *     threshold means the *generated* image reproduced a vault still: that is
 *     regurgitation, the one channel that speaks to training on the scans
 *     themselves rather than on public photos.
 *
 * The reference bytes are fetched fresh per run and never leave the vault except
 * to the identity provider (the documented, deferred consent question). This
 * module holds no long-lived reference cache.
 */

import { compareFaces, type RekognitionCredentials } from "@/lib/monitor/rekognition";
import { fetchImageBytes } from "@/lib/monitor/identity-check";
import { hashImage } from "@/lib/monitor/phash";
import { minDistanceAgainstIndex, type PhashIndexEntry } from "@/lib/monitor/phash-index";
import { presignR2Url, type R2SignEnv } from "@/lib/monitor/reference-set";

/** A probe-grade reference the scorer compares against. */
export interface ScoringReference {
  r2Key: string;
}

export interface SampleScore {
  rekognitionSimilarity: number | null;
  rekognitionMatches: number | null;
  rekognitionUnmatched: number | null;
  phashHex: string | null;
  phashMinDistance: number | null;
  /** How many face compares were actually billed (for spend recording). */
  comparisonsBilled: number;
}

/** Presign + fetch every probe-grade reference once, so a batch of samples
 *  reuses the same bytes instead of re-presigning per sample. */
export async function loadReferenceBytes(
  env: R2SignEnv,
  refs: ScoringReference[]
): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const ref of refs) {
    const url = await presignR2Url(env, ref.r2Key);
    if (!url) continue;
    const bytes = await fetchImageBytes(url);
    if (bytes) out.push(bytes);
  }
  return out;
}

export interface ScoreSampleInput {
  imageBytes: Uint8Array;
  referenceBytes: Uint8Array[];
  phashIndex: PhashIndexEntry[];
  rekognition: RekognitionCredentials | null;
  /** Stop comparing once a reference clears this similarity (early exit). */
  confirmThreshold?: number;
}

/**
 * Score one generated image. Identity = the best similarity across references
 * (early-exiting once a reference confirms). Derivation = min dHash distance
 * against the index. Pure of DB access; all I/O is the identity-provider call.
 */
export async function scoreSample(input: ScoreSampleInput): Promise<SampleScore> {
  const confirm = input.confirmThreshold ?? 0.85;

  // Derivation channel — CPU only, no third party, always attempted.
  const hashed = hashImage(input.imageBytes);
  const phashHex = hashed?.hashHex ?? null;
  const phashMinDistance =
    phashHex && input.phashIndex.length ? minDistanceAgainstIndex(phashHex, input.phashIndex) : null;

  // Identity channel — only when creds + references are present.
  let best: number | null = null;
  let bestMatches: number | null = null;
  let bestUnmatched: number | null = null;
  let comparisonsBilled = 0;

  if (input.rekognition && input.referenceBytes.length) {
    for (const refBytes of input.referenceBytes) {
      const result = await compareFaces(input.rekognition, refBytes, input.imageBytes);
      comparisonsBilled += 1;
      if (!result) continue;
      if (best === null || result.similarity > best) {
        best = result.similarity;
        bestMatches = result.matches;
        bestUnmatched = result.unmatched;
      }
      // Early exit: a confirmed match is a confirmed match; no need to keep
      // paying to compare against the rest of the gallery.
      if (result.similarity >= confirm) break;
    }
  }

  return {
    rekognitionSimilarity: best,
    rekognitionMatches: bestMatches,
    rekognitionUnmatched: bestUnmatched,
    phashHex,
    phashMinDistance,
    comparisonsBilled,
  };
}
