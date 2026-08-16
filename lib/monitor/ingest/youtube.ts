/**
 * YouTube discovery — the surface Instagram wouldn't give us.
 *
 * Strategically this may be the better primary source, for three reasons:
 *
 *  1. **Real free-text search.** The Data API searches titles and descriptions
 *     directly, which is exactly the capability Apify could not reach on
 *     Instagram. "tom hardy ai trailer" is a query we can actually run.
 *  2. **It's the official API.** No ToS violation, no scraping vendor, no
 *     operational risk — unlike the Instagram path, which is a knowing
 *     business decision.
 *  3. **It's where the format lives.** AI concept trailers are a YouTube-native
 *     genre; the Instagram posts we found are frequently reposts of them.
 *
 * Quota rather than money: 10,000 units/day free, and `search.list` costs 100
 * units, so ~100 searches/day. A sweep of six queries is 600 units. That means
 * no spend ceiling is needed here — but quota exhaustion returns 403, which is
 * treated as a soft failure so it degrades instead of erroring the sweep.
 */

import type { CandidateContent, DiscoverySource, TalentIdentityAnchor } from "../types";
import { vigilancePhrases } from "../vigilance";

const API_BASE = "https://www.googleapis.com/youtube/v3";

/**
 * Query suffixes, ordered by how specific the intent is. Unlike Instagram
 * hashtags these are free text, so we can be explicit about what we're hunting.
 */
export const YOUTUBE_QUERY_SUFFIXES = [
  "ai trailer",
  "deepfake",
  "ai concept trailer",
  "fan made trailer",
  "ai generated",
] as const;

export function buildYouTubeQueries(anchor: TalentIdentityAnchor, max = 5): string[] {
  const name = anchor.fullName.trim();
  if (!name) return [];
  const queries = YOUTUBE_QUERY_SUFFIXES.map((s) => `${name} ${s}`);
  for (const title of anchor.knownForTitles.slice(0, 2)) {
    queries.push(`${title} ${name} ai concept trailer`);
  }
  // Quota here is units, not money, and the announcement phrases are the ones
  // most likely to surface a concept trailer cut this week — so they go in
  // front of the standing set and lift the cap rather than displacing it.
  const vigilance = anchor.vigilance
    ? vigilancePhrases(name, anchor.vigilance, anchor.vigilance.phase === "peak" ? 3 : 2)
    : [];
  return [...vigilance, ...queries].slice(0, max + vigilance.length);
}

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    channelId?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
}

interface YouTubeSearchResponse {
  items?: YouTubeSearchItem[];
  error?: { message?: string; errors?: Array<{ reason?: string }> };
}

export class YouTubeError extends Error {
  constructor(
    readonly reason: "auth" | "quota" | "network" | "bad_response",
    message: string
  ) {
    super(message);
    this.name = "YouTubeError";
  }
}

function daysAgo(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function mapSearchItem(item: YouTubeSearchItem, source: DiscoverySource): CandidateContent | null {
  const videoId = item.id?.videoId;
  const snippet = item.snippet;
  if (!videoId || !snippet) return null;

  const thumbs = snippet.thumbnails ?? {};
  const thumbnailUrl =
    thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null;

  return {
    platform: "youtube",
    contentType: "video",
    contentUrl: `https://www.youtube.com/watch?v=${videoId}`,
    authorHandle: snippet.channelTitle ? `@${snippet.channelTitle}` : "@unknown",
    // Title carries the strongest intent signal on YouTube, so it leads the
    // caption the adjudicator reads.
    caption: [snippet.title, snippet.description].filter(Boolean).join("\n\n").slice(0, 2000),
    media: { thumbnailUrl, videoUrl: null },
    discoverySource: source,
    authorMeta: {
      platformUserId: snippet.channelId ?? null,
      displayName: snippet.channelTitle ?? null,
      // search.list carries no statistics; a videos.list call would, at extra
      // quota. Left null rather than guessed.
      followerCount: null,
      verified: false,
    },
    signals: {
      faceEmbeddingSimilarity: null,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: null,
      postedDaysAgo: daysAgo(snippet.publishedAt),
      viewCount: 0,
    },
  };
}

export function youtubeApiKey(env?: { YOUTUBE_API_KEY?: string }): string | null {
  const key = env?.YOUTUBE_API_KEY ?? process.env.YOUTUBE_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

async function searchOnce(
  apiKey: string,
  query: string,
  maxResults: number,
  signal?: AbortSignal
): Promise<YouTubeSearchItem[]> {
  const params = new URLSearchParams({
    key: apiKey,
    part: "snippet",
    type: "video",
    q: query,
    maxResults: String(Math.min(50, maxResults)),
    order: "relevance",
    // Recent content is what still has takedown value; older uploads have
    // already earned whatever they were going to earn.
    publishedAfter: new Date(Date.now() - 365 * 86_400_000).toISOString(),
  });

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/search?${params}`, { signal });
  } catch (err) {
    throw new YouTubeError("network", `YouTube request failed: ${(err as Error).message}`);
  }

  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as YouTubeSearchResponse;
    const reason = body.error?.errors?.[0]?.reason ?? "";
    throw new YouTubeError(
      reason.includes("quota") ? "quota" : "auth",
      body.error?.message ?? "YouTube returned 403"
    );
  }
  if (!res.ok) {
    throw new YouTubeError("bad_response", `YouTube returned ${res.status}`);
  }

  const body = (await res.json()) as YouTubeSearchResponse;
  return body.items ?? [];
}

export interface YouTubeDiscoveryResult {
  candidates: CandidateContent[];
  queriesRun: number;
  queriesFailed: number;
  quotaExhausted: boolean;
}

/**
 * Sweep YouTube for this talent. Never throws — YouTube is a supplementary
 * surface, and a quota wall should quietly reduce coverage rather than fail a
 * sweep that Instagram is also feeding.
 */
export async function discoverYouTube(opts: {
  apiKey: string;
  anchor: TalentIdentityAnchor;
  maxQueries?: number;
  resultsPerQuery?: number;
  signal?: AbortSignal;
}): Promise<YouTubeDiscoveryResult> {
  const queries = buildYouTubeQueries(opts.anchor, opts.maxQueries ?? 5);
  const candidates: CandidateContent[] = [];
  const seen = new Set<string>();
  let queriesFailed = 0;
  let quotaExhausted = false;

  for (const query of queries) {
    if (quotaExhausted) break;
    try {
      const items = await searchOnce(opts.apiKey, query, opts.resultsPerQuery ?? 25, opts.signal);
      const source: DiscoverySource = { mode: "hashtag", query: `youtube:${query}` };
      for (const item of items) {
        const mapped = mapSearchItem(item, source);
        if (mapped && !seen.has(mapped.contentUrl)) {
          seen.add(mapped.contentUrl);
          candidates.push(mapped);
        }
      }
    } catch (err) {
      queriesFailed++;
      if (err instanceof YouTubeError && err.reason === "quota") quotaExhausted = true;
      if (err instanceof YouTubeError && err.reason === "auth") break;
    }
  }

  return { candidates, queriesRun: queries.length, queriesFailed, quotaExhausted };
}

export { mapSearchItem as mapYouTubeItem };
