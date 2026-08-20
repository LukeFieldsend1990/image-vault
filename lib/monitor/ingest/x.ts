/**
 * X (Twitter) discovery via Apify.
 *
 * X's native search is exactly the surface AI-likeness accounts post into —
 * synthetic clips circulate as quote-tweeted video with the talent's name in
 * the text, so free-text search works here the way it does on TikTok and
 * YouTube. The actor bills per tweet returned, so it sits behind the same
 * Apify spend ceiling as every other scraped surface.
 */

import type { CandidateContent, DiscoverySource, TalentIdentityAnchor } from "../types";
import { ApifyError, runActor, type ActorBudget } from "./apify";
import { effectiveRunCost } from "./budget";

/** Free-text tweet search actor (Tweet Scraper V2). */
export const X_ACTOR = "apidojo~tweet-scraper";

export const X_QUERY_SUFFIXES = ["ai", "deepfake", "ai video"] as const;

export function buildXQueries(
  anchor: TalentIdentityAnchor,
  max = 3,
  learnedHashtags: string[] = []
): string[] {
  const name = anchor.fullName.trim();
  if (!name) return [];
  const base = X_QUERY_SUFFIXES.map((s) => `${name} ${s}`).slice(0, max);
  // Learned hashtags from confirmed hits ride natively — X search treats
  // '#tag' as first-class. Additive to the cap, same contract as TikTok.
  const learned = learnedHashtags.slice(0, 3).map((h) => `#${h.replace(/^#/, "")}`);
  return [...base, ...learned];
}

/** The subset of the actor's tweet shape we rely on. Everything optional. */
interface XItem {
  id?: string;
  url?: string;
  twitterUrl?: string;
  text?: string;
  fullText?: string;
  createdAt?: string;
  viewCount?: number;
  likeCount?: number;
  author?: {
    id?: string;
    userName?: string;
    name?: string;
    followers?: number;
    isVerified?: boolean;
    isBlueVerified?: boolean;
  };
  entities?: { hashtags?: Array<{ text?: string }> };
}

function daysAgo(dateString?: string): number {
  if (!dateString) return 0;
  const t = Date.parse(dateString);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function mapXItem(item: XItem, source: DiscoverySource): CandidateContent | null {
  const handle = item.author?.userName?.trim();
  const url = item.url ?? item.twitterUrl;
  if (!handle || !url) return null;

  return {
    platform: "x",
    contentType: "post",
    contentUrl: url,
    authorHandle: `@${handle}`,
    caption: item.fullText ?? item.text ?? "",
    hashtags: (item.entities?.hashtags ?? [])
      .map((h) => h.text?.toLowerCase())
      .filter((t): t is string => !!t),
    discoverySource: source,
    authorMeta: {
      platformUserId: item.author?.id ?? null,
      displayName: item.author?.name ?? null,
      followerCount: typeof item.author?.followers === "number" ? item.author.followers : null,
      verified: item.author?.isVerified === true || item.author?.isBlueVerified === true,
    },
    signals: {
      faceEmbeddingSimilarity: null,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: null,
      postedDaysAgo: daysAgo(item.createdAt),
      viewCount: item.viewCount ?? item.likeCount ?? 0,
    },
  };
}

export interface XDiscoveryResult {
  candidates: CandidateContent[];
  queriesRun: number;
  queriesFailed: number;
  costUsd: number;
  budgetStopped: string | null;
}

export async function discoverX(opts: {
  token: string;
  anchor: TalentIdentityAnchor;
  maxQueries?: number;
  resultsPerQuery?: number;
  learnedHashtags?: string[];
  signal?: AbortSignal;
  budget?: ActorBudget;
}): Promise<XDiscoveryResult> {
  const queries = buildXQueries(opts.anchor, opts.maxQueries ?? 3, opts.learnedHashtags ?? []);
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
      const run = await runActor<XItem>({
        token: opts.token,
        actorId: X_ACTOR,
        input: { searchTerms: [query], maxItems: resultsLimit, sort: "Latest" },
        maxItems: resultsLimit,
        signal: opts.signal,
      });
      const source: DiscoverySource = { mode: "hashtag", query: `x:${query}` };
      for (const item of run.items) {
        const mapped = mapXItem(item, source);
        if (mapped && !seen.has(mapped.contentUrl)) {
          seen.add(mapped.contentUrl);
          candidates.push(mapped);
        }
      }
      await opts.budget?.record({
        runId: run.runId,
        actorId: X_ACTOR,
        mode: "x_search",
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
          actorId: X_ACTOR,
          mode: "x_search",
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
