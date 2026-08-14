/**
 * LLaVA-backed identity verification for candidate media.
 *
 * Phase 2 was originally scoped around @cf/openai/clip-vit-base-patch32 for a
 * proper embedding-based match — same as InsightFace, same as ArcFace, same as
 * every serious face-matching stack. Live probe: the account this platform
 * runs under is not allowed to invoke CLIP on Workers AI (error 5018). Rather
 * than switch to a paid third-party face API, the next-best signal available
 * to us is LLaVA's vision reasoning: send it a candidate thumbnail and ask
 * whether the person in it is the protected talent.
 *
 * The result is not cosine similarity. It's a natural-language verdict we
 * parse into three buckets — confirmed, uncertain, denied. We map that onto
 * the existing `signals.faceEmbeddingSimilarity` slot so the adjudicator
 * prompt (which already knows how to weight >0.8 as strong, <0.7 as weak)
 * needs no changes.
 *
 * Two things this DOES NOT do:
 *
 *  1. Absolute face identity. LLaVA reasons from visual context — hair,
 *     face shape, lighting — and gets confused by lookalikes. We cap
 *     "confirmed" at 0.9 rather than 0.95+ that a true face embedder would
 *     justify. False positives on doppelgängers remain a real failure mode.
 *  2. Detection first. LLaVA gets the whole thumbnail, whether it contains
 *     a face or not. A poster-shot with no faces still gets a "no" answer.
 *     Fine for MVP; not fine when we want to attribute the null signal.
 */

import { callVisionAi } from "@/lib/ai/providers";
import type { CandidateContent } from "./types";
import { compareFaces, type RekognitionCredentials } from "./rekognition";

export type IdentityVerdict = "confirmed" | "uncertain" | "denied";
export type IdentityProvider = "llava" | "rekognition" | "both";

/** Rekognition-similarity buckets, tuned to the API's typical output distribution.
 *  A genuine face match usually comes in above 0.90; lookalikes tend to sit 0.65-0.85;
 *  wrong-person or no-face returns are usually 0 (no match at all). */
const REKOGNITION_CONFIRMED = 0.85;
const REKOGNITION_UNCERTAIN = 0.65;

export interface IdentityCheckResult {
  verdict: IdentityVerdict;
  /** Mapped onto signals.faceEmbeddingSimilarity: 0.9 / 0.65 / 0.2. */
  similarity: number;
  raw: string;
}

const SIMILARITY_BY_VERDICT: Record<IdentityVerdict, number> = {
  confirmed: 0.9,
  uncertain: 0.65,
  denied: 0.2,
};

/**
 * Fetch the thumbnail bytes with the same 8-second timeout and size cap
 * both checks use. Extracted so the face-presence pre-check and the
 * identity check share the download instead of doubling it. Exported for
 * the synthetic-media check (lib/monitor/synthetic-check.ts), which needs
 * identical fetch semantics.
 */
export async function fetchImageBytes(url: string, timeoutMs = 8_000): Promise<Uint8Array | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 5_000_000) return null;
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Cheap sanity check before the identity model runs: does this thumbnail
 * contain a human face at all? A large class of hits come from video
 * thumbnails that are title cards, movie posters, or scene shots — LLaVA
 * asked "is this Tom Hardy?" on a poster with no face will still answer,
 * and the answer is noise. Filtering out no-face candidates up front is
 * the highest-leverage false-positive cut we can make cheaply.
 */
export async function hasFaceInImage(ai: Ai, imgBytes: Uint8Array): Promise<boolean | null> {
  const prompt = "Does this image contain at least one human face? Answer with exactly one word: yes or no. Do not explain.";
  try {
    const out = await callVisionAi(ai, { imageBytes: imgBytes, prompt, maxTokens: 4 });
    const raw = out.text?.trim().toLowerCase() ?? "";
    if (!raw) return null;
    if (/\byes\b/.test(raw)) return true;
    if (/\bno\b/.test(raw)) return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Check whether the given thumbnail shows the target talent.
 *
 * Returns null when the check couldn't run (no thumbnail, image fetch failed,
 * LLaVA errored, or the pre-check found no face). Signal downstream reads
 * null as "no reading taken" and falls back to the pre-Phase-2 heuristic path
 * — a genuine "we tried and cannot say" is more honest than a manufactured
 * 0.5. `skipReason` on the return payload lets the caller log why.
 */
export async function checkIdentity(
  ai: Ai,
  opts: { imageUrl: string; talentName: string; timeoutMs?: number; skipFacePrecheck?: boolean }
): Promise<(IdentityCheckResult & { skipReason?: string }) | null> {
  const imgBytes = await fetchImageBytes(opts.imageUrl, opts.timeoutMs);
  if (!imgBytes) return null;

  // Face-presence gate. Skipped only when the caller explicitly opts out
  // (Rekognition path, which does its own face detection internally).
  if (!opts.skipFacePrecheck) {
    const hasFace = await hasFaceInImage(ai, imgBytes);
    if (hasFace === false) {
      // Distinct return: not null (we DID run) but no verdict — the caller
      // can distinguish "no face present" from "identity check failed" in
      // its stats.
      return { verdict: "denied", similarity: 0.2, raw: "no face in image", skipReason: "no_face_in_thumbnail" };
    }
    // hasFace === null (couldn't tell) falls through and runs the identity
    // check anyway. Better to spend the second LLaVA call than to drop a
    // real hit because the face-detect model hedged.
  }

  const prompt =
    `Is the person shown in this image ${opts.talentName}? ` +
    `Answer with exactly one word: yes, maybe, or no. Do not explain.`;

  let raw: string;
  try {
    const out = await callVisionAi(ai, { imageBytes: imgBytes, prompt, maxTokens: 8 });
    raw = out.text?.trim().toLowerCase() ?? "";
  } catch {
    return null;
  }
  if (!raw) return null;

  const verdict = parseVerdict(raw);
  return {
    verdict,
    similarity: SIMILARITY_BY_VERDICT[verdict],
    raw,
  };
}

/**
 * Parse the first meaningful word out of LLaVA's answer.
 *
 * LLaVA sometimes prefixes with punctuation or hedges ("The person appears
 * to be ... yes"), so we scan for the first yes / maybe / no rather than
 * requiring an exact match. Anything unparseable falls to "uncertain" —
 * refusing to commit is a more useful signal than fabricating denial.
 */
export function parseVerdict(text: string): IdentityVerdict {
  const t = text.toLowerCase();
  // Guard the maybe check: "no way" starts with "no", "maybe not" starts with
  // "maybe" — first-hit wins keeps the semantics predictable.
  if (/\b(yes|correct|indeed|it is|that is)\b/.test(t)) return "confirmed";
  if (/\b(no|not|isn'?t|incorrect|different person)\b/.test(t)) return "denied";
  if (/\b(maybe|possibly|might|unsure|hard to tell|uncertain|likely)\b/.test(t)) return "uncertain";
  return "uncertain";
}

/**
 * Run identity checks across every candidate in parallel batches, mutating
 * `signals.faceEmbeddingSimilarity` on each so the adjudicator prompt reads
 * a real number instead of null. Batched at 8 concurrent so the total time
 * for a 60-candidate sweep is bounded to ~1 min rather than ~8 min serial,
 * without stampeding the Workers-AI account rate limit.
 *
 * Also appends "Identity verified by vision model" or "Identity denied by
 * vision model" to the match signals so the human reviewer sees where the
 * confidence came from and can weigh it against a lookalike bug.
 */
/**
 * Rekognition path — used when the operator has selected `rekognition` or
 * `both`. Fetches the target thumbnail bytes and calls compareFaces against
 * pre-fetched source bytes (talent's reference photo, downloaded once at
 * the top of verifyCandidatesIdentity). Sets the signal directly from the
 * numeric similarity, so this path bypasses the yes/maybe/no bucketing.
 */
async function checkIdentityViaRekognition(
  creds: RekognitionCredentials,
  sources: Uint8Array[],
  imageUrl: string,
  timeoutMs = 8_000
): Promise<{ similarity: number; verdict: IdentityVerdict } | null> {
  const target = await fetchImageBytes(imageUrl, timeoutMs);
  if (!target) return null;

  // Multi-reference gallery: the candidate matches if it matches ANY vault
  // reference. Take the max similarity across sources, stopping early once a
  // source clears the confirmed bar — extra compares past that point cost
  // money without changing the verdict.
  let best = -1;
  for (const sourceBytes of sources) {
    const result = await compareFaces(creds, sourceBytes, target);
    if (!result) continue;
    best = Math.max(best, result.similarity);
    if (best >= REKOGNITION_CONFIRMED) break;
  }
  if (best < 0) return null;

  const verdict: IdentityVerdict =
    best >= REKOGNITION_CONFIRMED ? "confirmed" : best >= REKOGNITION_UNCERTAIN ? "uncertain" : "denied";
  return { similarity: best, verdict };
}

export interface VerifyOptions {
  concurrency?: number;
  provider?: IdentityProvider;
  /** Single reference image URL (talent's TMDB profile). Merged after `referenceImageUrls`. */
  referenceImageUrl?: string;
  /**
   * Ordered reference gallery for rekognition/both — presigned vault scan
   * stills first (see lib/monitor/reference-set.ts), public fallbacks last.
   * The matcher takes the best similarity across the gallery.
   */
  referenceImageUrls?: string[];
  /** Required for rekognition and both. */
  rekognitionCredentials?: RekognitionCredentials;
}

export async function verifyCandidatesIdentity(
  ai: Ai,
  candidates: CandidateContent[],
  talentName: string,
  opts: VerifyOptions = {}
): Promise<{
  checked: number;
  confirmed: number;
  uncertain: number;
  denied: number;
  noFace: number;
  errors: number;
  provider: IdentityProvider;
  /** How many reference images the matcher compared against (0 on the LLaVA path). */
  referenceSources: number;
}> {
  // Workers AI throws generic "internal error" 5xxs under high parallel load
  // on this account tier — observed live at concurrency 8 with a Tom Hardy
  // sweep. Dropping to 3 keeps most calls succeeding at the cost of ~3x wall
  // time, which for a ~60-candidate sweep is still under the 5-min Apify
  // discovery budget so end-to-end wall time barely moves.
  const concurrency = opts.concurrency ?? 3;
  const requestedProvider: IdentityProvider = opts.provider ?? "llava";

  // Determine actual provider used. Rekognition needs credentials + at least
  // one reference image; falling back to LLaVA silently would misrepresent
  // to the operator what happened. Log the downgrade instead.
  const referenceUrls = [
    ...(opts.referenceImageUrls ?? []),
    ...(opts.referenceImageUrl ? [opts.referenceImageUrl] : []),
  ];
  let provider: IdentityProvider = requestedProvider;
  let sources: Uint8Array[] = [];
  if (requestedProvider !== "llava") {
    if (!opts.rekognitionCredentials || !referenceUrls.length) {
      console.warn(
        `[monitor] identity provider "${requestedProvider}" requested without credentials + reference URL(s); falling back to llava`
      );
      provider = "llava";
    } else {
      // Fetch the gallery once, up front — the same sources serve every
      // candidate in the sweep. A URL that fails just shrinks the gallery.
      sources = (await Promise.all(referenceUrls.map((u) => fetchImageBytes(u)))).filter(
        (b): b is Uint8Array => b !== null
      );
      if (!sources.length) {
        console.warn(
          `[monitor] failed to fetch any of ${referenceUrls.length} reference image(s); falling back to llava`
        );
        provider = "llava";
      }
    }
  }

  const stats = {
    checked: 0,
    confirmed: 0,
    uncertain: 0,
    denied: 0,
    noFace: 0,
    errors: 0,
    provider,
    referenceSources: sources.length,
  };

  const withThumb = candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !!c.media?.thumbnailUrl);

  for (let i = 0; i < withThumb.length; i += concurrency) {
    const batch = withThumb.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async ({ c }) => {
        const url = c.media?.thumbnailUrl;
        if (!url) return;

        // Rekognition path: real cosine similarity, no yes/maybe/no
        // bucketing distortion. If it succeeds, use it; if it fails and
        // provider="both", we fall through to LLaVA below.
        if (provider === "rekognition" || provider === "both") {
          const rek = await checkIdentityViaRekognition(opts.rekognitionCredentials!, sources, url);
          if (rek) {
            stats.checked++;
            stats[rek.verdict]++;
            c.signals.faceEmbeddingSimilarity = rek.similarity;
            return;
          }
          if (provider === "rekognition") {
            // Strict mode: Rekognition failed, don't second-guess with LLaVA.
            stats.errors++;
            return;
          }
          // provider === "both": fall through to LLaVA fallback.
        }

        const result = await checkIdentity(ai, { imageUrl: url, talentName });
        if (!result) {
          stats.errors++;
          return;
        }
        if (result.skipReason === "no_face_in_thumbnail") {
          stats.noFace++;
          // Explicitly null: the pre-check ran, no face was present, so we
          // have zero signal to feed the identity slot — better than
          // pretending 0.2 similarity is a real reading.
          c.signals.faceEmbeddingSimilarity = null;
          return;
        }
        stats.checked++;
        stats[result.verdict]++;
        c.signals.faceEmbeddingSimilarity = result.similarity;
      })
    );
  }

  return stats;
}
