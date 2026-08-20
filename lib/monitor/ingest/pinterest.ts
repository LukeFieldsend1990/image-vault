/**
 * Pinterest discovery via Apify.
 *
 * Pinterest hosts the still-image side of likeness misuse: AI "portrait packs"
 * and midjourney boards get pinned under the talent's name for reach, exactly
 * like the hashtag behaviour on Instagram. Search is free-text, so queries
 * follow the TikTok/X shape. Shares the Apify spend ceiling.
 */

import type { CandidateContent, DiscoverySource, TalentIdentityAnchor } from "../types";
import { ApifyError, runActor, type ActorBudget } from "./apify";
import { effectiveRunCost } from "./budget";

export const PINTEREST_ACTOR = "epctex~pinterest-scraper";

export const PINTEREST_QUERY_SUFFIXES = ["ai", "ai art", "midjourney"] as const;

export function buildPinterestQueries(
  anchor: TalentIdentityAnchor,
  max = 3,
  learnedHashtags: string[] = []
): string[] {
  const name = anchor.fullName.trim();
  if (!name) return [];
  const base = PINTEREST_QUERY_SUFFIXES.map((s) => `${name} ${s}`).slice(0, max);
  // Learned hashtags from confirmed hits go in as bare keywords — Pinterest
  // search is free text and a concatenated tag ("tomhardyrayleigh") works as
  // a search term where '#' would not. Additive to the cap.
  const learned = learnedHashtags.slice(0, 3).map((h) => h.replace(/^#/, ""));
  return [...base, ...learned];
}

/** The subset of the actor's pin shape we rely on. Everything optional. */
interface PinterestItem {
  id?: string;
  url?: string;
  title?: string;
  grid_title?: string;
  description?: string;
  created_at?: string;
  repin_count?: number;
  images?: { orig?: { url?: string } };
  pinner?: {
    id?: string;
    username?: string;
    full_name?: string;
    follower_count?: number;
  };
}

function daysAgo(dateString?: string): number {
  if (!dateString) return 0;
  const t = Date.parse(dateString);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function mapPinterestItem(
  item: PinterestItem,
  source: DiscoverySource
): CandidateContent | null {
  const handle = item.pinner?.username?.trim();
  const url = item.url ?? (item.id ? `https://www.pinterest.com/pin/${item.id}/` : null);
  if (!handle || !url) return null;

  return {
    platform: "pinterest",
    contentType: "post",
    contentUrl: url,
    authorHandle: `@${handle}`,
    caption: [item.title ?? item.grid_title, item.description].filter(Boolean).join("\n\n").slice(0, 2000),
    media: { thumbnailUrl: item.images?.orig?.url ?? null, videoUrl: null },
    discoverySource: source,
    authorMeta: {
      platformUserId: item.pinner?.id ?? null,
      displayName: item.pinner?.full_name ?? null,
      followerCount: typeof item.pinner?.follower_count === "number" ? item.pinner.follower_count : null,
      verified: false,
    },
    signals: {
      faceEmbeddingSimilarity: null,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: null,
      postedDaysAgo: daysAgo(item.created_at),
      viewCount: item.repin_count ?? 0,
    },
  };
}

export interface PinterestDiscoveryResult {
  candidates: CandidateContent[];
  queriesRun: number;
  queriesFailed: number;
  costUsd: number;
  budgetStopped: string | null;
}

export async function discoverPinterest(opts: {
  token: string;
  anchor: TalentIdentityAnchor;
  maxQueries?: number;
  resultsPerQuery?: number;
  learnedHashtags?: string[];
  signal?: AbortSignal;
  budget?: ActorBudget;
}): Promise<PinterestDiscoveryResult> {
  const queries = buildPinterestQueries(opts.anchor, opts.maxQueries ?? 3, opts.learnedHashtags ?? []);
  const resultsLimit = opts.resultsPerQuery ?? 40;
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
      const run = await runActor<PinterestItem>({
        token: opts.token,
        actorId: PINTEREST_ACTOR,
        input: {
          search: [query],
          maxItems: resultsLimit,
          endPage: 1,
          proxy: { useApifyProxy: true },
        },
        maxItems: resultsLimit,
        signal: opts.signal,
      });
      const source: DiscoverySource = { mode: "hashtag", query: `pinterest:${query}` };
      for (const item of run.items) {
        const mapped = mapPinterestItem(item, source);
        if (mapped && !seen.has(mapped.contentUrl)) {
          seen.add(mapped.contentUrl);
          candidates.push(mapped);
        }
      }
      await opts.budget?.record({
        runId: run.runId,
        actorId: PINTEREST_ACTOR,
        mode: "pinterest_search",
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
          actorId: PINTEREST_ACTOR,
          mode: "pinterest_search",
          query,
          itemCount: 0,
          costUsd: apifyErr.costUsd,
          status: "failed",
          error: apifyErr.reason,
        });
        costUsd += apifyErr.costUsd ?? 0;
      }
      // Credits exhaustion hits every remaining query identically and reads
      // as a coverage stop, same as the internal spend ceiling.
      if (apifyErr?.reason === "credits") {
        budgetStopped = "Apify account out of credits";
        break;
      }
      if (apifyErr?.reason === "auth") break;
    }
  }

  return { candidates, queriesRun, queriesFailed, costUsd, budgetStopped };
}
