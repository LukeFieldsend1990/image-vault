/**
 * TikTok discovery via Apify.
 *
 * Worth having specifically because TikTok's search actors accept free-text
 * keywords — the capability Instagram's actors do not expose. That makes it the
 * closest thing to "search the way a person would" that the scraping route
 * offers, and it should be measured against YouTube before either is trusted
 * as a primary source.
 *
 * Shares the Apify client, so it shares the spend ceiling. Same budget gate,
 * same ledger, same rules.
 */

import type { CandidateContent, DiscoverySource, TalentIdentityAnchor } from "../types";
import { ApifyError, runActor } from "./apify";
import { effectiveRunCost } from "./budget";
import { vigilancePhrases } from "../vigilance";

/** Keyword search actor. Unlike Instagram's, this one takes real phrases. */
export const TIKTOK_ACTOR = "clockworks~tiktok-scraper";

export const TIKTOK_QUERY_SUFFIXES = ["ai", "deepfake", "ai trailer", "concept trailer"] as const;

export function buildTikTokQueries(
  anchor: TalentIdentityAnchor,
  max = 4,
  learnedHashtags: string[] = []
): string[] {
  const name = anchor.fullName.trim();
  if (!name) return [];
  // An open announcement window goes first: TikTok takes phrases, and "Kit
  // Connor Cyclops" is the least ambiguous query this surface will ever accept
  // for a talent whose new role is three days old.
  const vigilance = anchor.vigilance
    ? vigilancePhrases(name, anchor.vigilance, anchor.vigilance.phase === "peak" ? 3 : 2)
    : [];
  const base = TIKTOK_QUERY_SUFFIXES.map((s) => `${name} ${s}`);
  // Learned hashtags come in as bare tags (e.g. "tomhardyrayleigh") from
  // the mining pass. TikTok search takes phrases, so we prefix "#" and
  // append them after the base set — TIKTOK_QUERY_SUFFIXES is the tried
  // vocabulary, learned queries expand it.
  const learned = learnedHashtags.map((h) => `#${h}`);
  // The window's phrases are additive to the cap for the same reason they are
  // first: dropping proven vocabulary to make room for them would trade
  // coverage for coverage rather than adding any.
  return [...vigilance, ...base, ...learned].slice(
    0,
    max + vigilance.length + Math.min(learnedHashtags.length, 3)
  );
}

interface TikTokItem {
  id?: string;
  text?: string;
  webVideoUrl?: string;
  createTimeISO?: string;
  diggCount?: number;
  playCount?: number;
  shareCount?: number;
  authorMeta?: {
    name?: string;
    nickName?: string;
    id?: string;
    fans?: number;
    verified?: boolean;
  };
  videoMeta?: { coverUrl?: string; originalCoverUrl?: string };
  hashtags?: Array<{ name?: string }>;
}

function daysAgo(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function mapTikTokItem(item: TikTokItem, source: DiscoverySource): CandidateContent | null {
  const handle = item.authorMeta?.name?.trim();
  const url = item.webVideoUrl;
  if (!handle || !url) return null;

  return {
    platform: "tiktok",
    contentType: "video",
    contentUrl: url,
    authorHandle: `@${handle}`,
    caption: item.text ?? "",
    hashtags: (item.hashtags ?? [])
      .map((h) => h.name?.toLowerCase())
      .filter((n): n is string => !!n),
    media: {
      thumbnailUrl: item.videoMeta?.coverUrl ?? item.videoMeta?.originalCoverUrl ?? null,
      videoUrl: null,
    },
    discoverySource: source,
    authorMeta: {
      platformUserId: item.authorMeta?.id ?? null,
      displayName: item.authorMeta?.nickName ?? null,
      followerCount: typeof item.authorMeta?.fans === "number" ? item.authorMeta.fans : null,
      verified: item.authorMeta?.verified === true,
    },
    signals: {
      faceEmbeddingSimilarity: null,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: null,
      postedDaysAgo: daysAgo(item.createTimeISO),
      viewCount: item.playCount ?? item.diggCount ?? 0,
    },
  };
}

export interface TikTokDiscoveryResult {
  candidates: CandidateContent[];
  queriesRun: number;
  queriesFailed: number;
  costUsd: number;
  budgetStopped: string | null;
}

export async function discoverTikTok(opts: {
  token: string;
  anchor: TalentIdentityAnchor;
  maxQueries?: number;
  resultsPerQuery?: number;
  /** Learned hashtags from prior sweeps for this talent (bare, no '#'). */
  learnedHashtags?: string[];
  signal?: AbortSignal;
  budget?: {
    check: () => Promise<{ ok: boolean; reason: string | null }>;
    record: (entry: {
      runId: string | null;
      actorId: string;
      mode: string;
      query: string;
      itemCount: number;
      costUsd: number | null;
      status: "succeeded" | "failed";
      error?: string;
    }) => Promise<void>;
  };
}): Promise<TikTokDiscoveryResult> {
  const queries = buildTikTokQueries(opts.anchor, opts.maxQueries ?? 4, opts.learnedHashtags ?? []);
  const resultsLimit = opts.resultsPerQuery ?? 50;
  const candidates: CandidateContent[] = [];
  const seen = new Set<string>();
  let queriesRun = 0;
  let queriesFailed = 0;
  let costUsd = 0;
  let budgetStopped: string | null = null;

  for (const query of queries) {
    if (opts.budget) {
      const verdict = await opts.budget.check();
      if (!verdict.ok) {
        budgetStopped = verdict.reason ?? "Apify spend limit reached";
        break;
      }
    }

    queriesRun++;
    try {
      const run = await runActor<TikTokItem>({
        token: opts.token,
        actorId: TIKTOK_ACTOR,
        input: { searchQueries: [query], resultsPerPage: resultsLimit, shouldDownloadVideos: false },
        maxItems: resultsLimit,
        signal: opts.signal,
      });
      const source: DiscoverySource = { mode: "hashtag", query: `tiktok:${query}` };
      for (const item of run.items) {
        const mapped = mapTikTokItem(item, source);
        if (mapped && !seen.has(mapped.contentUrl)) {
          seen.add(mapped.contentUrl);
          candidates.push(mapped);
        }
      }
      await opts.budget?.record({
        runId: run.runId,
        actorId: TIKTOK_ACTOR,
        mode: "tiktok_search",
        query,
        itemCount: run.items.length,
        costUsd: run.costUsd,
        status: "succeeded",
      });
      costUsd += effectiveRunCost(run.costUsd, run.items.length).costUsd;
    } catch (err) {
      queriesFailed++;
      const apifyErr = err instanceof ApifyError ? err : null;
      if (apifyErr?.runId) {
        await opts.budget?.record({
          runId: apifyErr.runId,
          actorId: TIKTOK_ACTOR,
          mode: "tiktok_search",
          query,
          itemCount: 0,
          costUsd: apifyErr.costUsd,
          status: "failed",
          error: apifyErr.reason,
        });
        costUsd += apifyErr.costUsd ?? 0;
      }
      if (apifyErr?.reason === "auth") break;
    }
  }

  return { candidates, queriesRun, queriesFailed, costUsd, budgetStopped };
}
