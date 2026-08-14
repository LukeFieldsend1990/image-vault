/**
 * AI-platform discovery — the "midjourney" registry entry.
 *
 * Midjourney's own showcase sits behind auth and has no public search, but the
 * highest-value AI-platform surface is public anyway: Civitai's model registry,
 * where community LoRAs and checkpoints are listed by name. A LoRA titled with
 * the talent's name IS the likeness-model misuse the monitor exists to catch —
 * not a clip that used their face once, but a distributable model of it. That
 * is why hits from here map to the "model training" end of the risk scale.
 *
 * The API is free and unauthenticated (https://developer.civitai.com), so this
 * module needs no Apify token and books nothing against the spend ceiling.
 * Like YouTube, it never fails a sweep on its own.
 */

import type { CandidateContent, DiscoverySource, TalentIdentityAnchor } from "../types";

const CIVITAI_BASE = "https://civitai.com/api/v1";

/** The subset of Civitai's model shape we rely on. Everything optional. */
interface CivitaiModel {
  id?: number;
  name?: string;
  description?: string;
  type?: string;
  nsfw?: boolean;
  tags?: string[];
  creator?: { username?: string };
  stats?: { downloadCount?: number; thumbsUpCount?: number };
  modelVersions?: Array<{
    createdAt?: string;
    images?: Array<{ url?: string }>;
  }>;
}

interface CivitaiResponse {
  items?: CivitaiModel[];
}

function daysAgo(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/** Civitai descriptions are HTML; the adjudicator wants prose. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapCivitaiModel(model: CivitaiModel, source: DiscoverySource): CandidateContent | null {
  const id = model.id;
  const name = model.name?.trim();
  if (!id || !name) return null;

  const latest = model.modelVersions?.[0];
  const modelType = model.type ?? "model";
  // Lead the caption with what this object *is* — a downloadable likeness
  // model, self-declared AI by construction — so both the pre-filter's
  // intent gate and the adjudicator read it correctly.
  const caption = [
    `Downloadable AI likeness model (${modelType}) published on Civitai: "${name}".`,
    model.description ? stripHtml(model.description).slice(0, 1200) : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    platform: "midjourney",
    contentType: "image",
    contentUrl: `https://civitai.com/models/${id}`,
    authorHandle: `@${model.creator?.username?.trim() || "unknown"}`,
    caption,
    hashtags: (model.tags ?? []).map((t) => t.toLowerCase()),
    media: { thumbnailUrl: latest?.images?.[0]?.url ?? null, videoUrl: null },
    discoverySource: source,
    authorMeta: {
      platformUserId: null,
      displayName: model.creator?.username ?? null,
      followerCount: null,
      verified: false,
    },
    signals: {
      faceEmbeddingSimilarity: null,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: null,
      postedDaysAgo: daysAgo(latest?.createdAt),
      // Downloads are the reach metric that matters for a model: each one is
      // a copy that can generate indefinitely.
      viewCount: model.stats?.downloadCount ?? model.stats?.thumbsUpCount ?? 0,
    },
  };
}

export interface AiPlatformDiscoveryResult {
  candidates: CandidateContent[];
  queriesRun: number;
  queriesFailed: number;
}

/**
 * Search Civitai for models named after the talent. Never throws — a
 * supplementary surface degrades quietly, same contract as YouTube.
 */
export async function discoverAiPlatforms(opts: {
  anchor: TalentIdentityAnchor;
  limit?: number;
  signal?: AbortSignal;
}): Promise<AiPlatformDiscoveryResult> {
  const name = opts.anchor.fullName.trim();
  if (!name) return { candidates: [], queriesRun: 0, queriesFailed: 0 };

  const params = new URLSearchParams({
    query: name,
    limit: String(Math.min(50, opts.limit ?? 20)),
    // NSFW likeness models are the highest-harm class this surface hosts;
    // excluding them would blind the monitor exactly where it matters most.
    nsfw: "true",
  });

  try {
    const res = await fetch(`${CIVITAI_BASE}/models?${params}`, { signal: opts.signal });
    if (!res.ok) {
      console.warn(`[monitor] Civitai returned ${res.status}`);
      return { candidates: [], queriesRun: 1, queriesFailed: 1 };
    }
    const body = (await res.json()) as CivitaiResponse;
    const source: DiscoverySource = { mode: "user_search", query: `civitai:${name}` };
    const candidates: CandidateContent[] = [];
    const seen = new Set<string>();
    for (const model of body.items ?? []) {
      const mapped = mapCivitaiModel(model, source);
      if (mapped && !seen.has(mapped.contentUrl)) {
        seen.add(mapped.contentUrl);
        candidates.push(mapped);
      }
    }
    return { candidates, queriesRun: 1, queriesFailed: 0 };
  } catch (err) {
    console.warn(`[monitor] Civitai discovery failed: ${(err as Error).message}`);
    return { candidates: [], queriesRun: 1, queriesFailed: 1 };
  }
}
