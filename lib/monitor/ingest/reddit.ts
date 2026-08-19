/**
 * Reddit discovery via Apify.
 *
 * Reddit is where synthetic likeness content gets *organised*: dedicated
 * communities collect AI recasts, face-swaps and "portrait packs" under the
 * talent's name, and post titles carry the same declared-AI vocabulary that
 * free-text search keys on elsewhere. Search follows the TikTok/X shape; the
 * subreddit a post sits in is itself identity/intent evidence, so it is kept
 * on the candidate (caption prefix + hashtags) for the adjudicator. Shares
 * the Apify spend ceiling.
 */

import type { CandidateContent, DiscoverySource, TalentIdentityAnchor } from "../types";
import { ApifyError, runActor, type ActorBudget } from "./apify";
import { effectiveRunCost } from "./budget";

/** Pay-per-result Reddit search actor. */
export const REDDIT_ACTOR = "trudax~reddit-scraper-lite";

export const REDDIT_QUERY_SUFFIXES = ["ai", "deepfake", "ai generated"] as const;

export function buildRedditQueries(anchor: TalentIdentityAnchor, max = 3): string[] {
  const name = anchor.fullName.trim();
  if (!name) return [];
  return REDDIT_QUERY_SUFFIXES.map((s) => `${name} ${s}`).slice(0, max);
}

/** The subset of the actor's post shape we rely on. Everything optional. */
interface RedditItem {
  id?: string;
  parsedId?: string;
  url?: string;
  username?: string;
  userId?: string;
  title?: string;
  communityName?: string;
  parsedCommunityName?: string;
  body?: string;
  createdAt?: string;
  upVotes?: number;
  numberOfComments?: number;
  thumbnailUrl?: string;
  isAd?: boolean;
  over18?: boolean;
  dataType?: string;
}

function daysAgo(dateString?: string): number {
  if (!dateString) return 0;
  const t = Date.parse(dateString);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function mapRedditItem(item: RedditItem, source: DiscoverySource): CandidateContent | null {
  // Search can return comments/communities/users despite the post-only input;
  // only posts carry the title + community context the adjudicator needs.
  if (item.dataType && item.dataType !== "post") return null;
  if (item.isAd) return null;

  const handle = item.username?.replace(/^u\//, "").trim();
  const url = item.url;
  if (!handle || !url) return null;

  const subreddit = (item.parsedCommunityName ?? item.communityName?.replace(/^r\//, ""))
    ?.trim()
    .toLowerCase();

  return {
    platform: "reddit",
    contentType: "post",
    contentUrl: url,
    authorHandle: `@${handle}`,
    // The subreddit leads the caption: "r/SFWdeepfakes" is often stronger
    // intent evidence than the post title itself.
    caption: [subreddit ? `[r/${subreddit}]` : null, item.title, item.body]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 2000),
    hashtags: subreddit ? [subreddit] : [],
    nsfw: item.over18 === true,
    media: { thumbnailUrl: item.thumbnailUrl ?? null, videoUrl: null },
    discoverySource: source,
    authorMeta: {
      platformUserId: item.userId ?? null,
      displayName: handle,
      followerCount: null,
      verified: false,
    },
    signals: {
      faceEmbeddingSimilarity: null,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: null,
      postedDaysAgo: daysAgo(item.createdAt),
      viewCount: item.upVotes ?? 0,
    },
  };
}

export interface RedditDiscoveryResult {
  candidates: CandidateContent[];
  queriesRun: number;
  queriesFailed: number;
  costUsd: number;
  budgetStopped: string | null;
}

export async function discoverReddit(opts: {
  token: string;
  anchor: TalentIdentityAnchor;
  maxQueries?: number;
  resultsPerQuery?: number;
  signal?: AbortSignal;
  budget?: ActorBudget;
}): Promise<RedditDiscoveryResult> {
  const queries = buildRedditQueries(opts.anchor, opts.maxQueries ?? 3);
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
      const run = await runActor<RedditItem>({
        token: opts.token,
        actorId: REDDIT_ACTOR,
        input: {
          searches: [query],
          searchPosts: true,
          searchComments: false,
          searchCommunities: false,
          searchUsers: false,
          // Misuse skews adult; filtering NSFW out would blind the sweep to
          // exactly the content the monitor exists to find.
          includeNSFW: true,
          sort: "new",
          maxItems: resultsLimit,
          proxy: { useApifyProxy: true },
        },
        maxItems: resultsLimit,
        signal: opts.signal,
      });
      const source: DiscoverySource = { mode: "hashtag", query: `reddit:${query}` };
      for (const item of run.items) {
        const mapped = mapRedditItem(item, source);
        if (mapped && !seen.has(mapped.contentUrl)) {
          seen.add(mapped.contentUrl);
          candidates.push(mapped);
        }
      }
      await opts.budget?.record({
        runId: run.runId,
        actorId: REDDIT_ACTOR,
        mode: "reddit_search",
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
          actorId: REDDIT_ACTOR,
          mode: "reddit_search",
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
