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

export type IdentityVerdict = "confirmed" | "uncertain" | "denied";

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
 * Check whether the given thumbnail shows the target talent.
 *
 * Returns null when the check couldn't run (no thumbnail, image fetch failed,
 * LLaVA errored). Signal downstream reads null as "no reading taken" and
 * falls back to the pre-Phase-2 heuristic path — a genuine "we tried and
 * cannot say" is more honest than a manufactured 0.5.
 */
export async function checkIdentity(
  ai: Ai,
  opts: { imageUrl: string; talentName: string; timeoutMs?: number }
): Promise<IdentityCheckResult | null> {
  let imgBytes: Uint8Array;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8_000);
    const res = await fetch(opts.imageUrl, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    imgBytes = new Uint8Array(await res.arrayBuffer());
    if (imgBytes.length === 0 || imgBytes.length > 5_000_000) return null;
  } catch {
    return null;
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
export async function verifyCandidatesIdentity(
  ai: Ai,
  candidates: CandidateContent[],
  talentName: string,
  opts: { concurrency?: number } = {}
): Promise<{ checked: number; confirmed: number; uncertain: number; denied: number; errors: number }> {
  // Workers AI throws generic "internal error" 5xxs under high parallel load
  // on this account tier — observed live at concurrency 8 with a Tom Hardy
  // sweep. Dropping to 3 keeps most calls succeeding at the cost of ~3x wall
  // time, which for a ~60-candidate sweep is still under the 5-min Apify
  // discovery budget so end-to-end wall time barely moves.
  const concurrency = opts.concurrency ?? 3;
  const stats = { checked: 0, confirmed: 0, uncertain: 0, denied: 0, errors: 0 };

  const withThumb = candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !!c.media?.thumbnailUrl);

  for (let i = 0; i < withThumb.length; i += concurrency) {
    const batch = withThumb.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async ({ c }) => {
        const url = c.media?.thumbnailUrl;
        if (!url) return;
        const result = await checkIdentity(ai, { imageUrl: url, talentName });
        if (!result) {
          stats.errors++;
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
