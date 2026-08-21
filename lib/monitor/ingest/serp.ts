/**
 * Search-results discovery via Apify's official Google Search scraper —
 * serving two registry platforms:
 *
 *  - "google": open-web image/page results for AI-generated uses of the
 *    talent's likeness.
 *  - "getty": the stock-library surface, reached with `site:` operators
 *    against gettyimages.com and shutterstock.com. Stock sites have no
 *    scrapeable search of their own worth paying for; Google's index of them
 *    is the practical route, and AI-generated "editorial style" stock of real
 *    actors is an emerging misuse class.
 *
 * One actor run covers a platform's whole query set (the actor takes
 * newline-separated queries), so each sweep books a single budget entry here.
 */

import type { CandidateContent, DiscoverySource, TalentIdentityAnchor } from "../types";
import { ApifyError, runActor, type ActorBudget } from "./apify";
import { effectiveRunCost } from "./budget";

export const SERP_ACTOR = "apify~google-search-scraper";

export type SerpPlatform = "google" | "getty";

export function buildSerpQueries(
  platform: SerpPlatform,
  anchor: TalentIdentityAnchor,
  learnedHashtags: string[] = []
): string[] {
  const name = anchor.fullName.trim();
  if (!name) return [];
  // Learned hashtags from confirmed hits, as exact-match tokens. A mined tag
  // is a concatenated phrase ("tomhardyrayleigh") that Google only surfaces
  // quoted; getty queries keep the site scope that defines the platform.
  const learned = learnedHashtags.slice(0, 2).map((h) => h.replace(/^#/, ""));
  if (platform === "getty") {
    return [
      `site:gettyimages.com "${name}" ai`,
      `site:shutterstock.com "${name}" ai`,
      ...learned.map((h) => `site:gettyimages.com "${h}"`),
    ];
  }
  return [
    `"${name}" ai generated images`,
    `"${name}" deepfake`,
    ...learned.map((h) => `"${h}"`),
  ];
}

/** The subset of the SERP actor's page shape we rely on. */
interface SerpPageItem {
  searchQuery?: { term?: string };
  organicResults?: Array<{
    title?: string;
    url?: string;
    description?: string;
  }>;
}

/**
 * A SERP result's "author" is the hosting site. Domains work as offender-file
 * handles the way account names do elsewhere: recurring hosts accumulate a
 * case file in monitor_accounts keyed by hostname.
 */
function hostnameHandle(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function mapSerpResult(
  platform: SerpPlatform,
  result: { title?: string; url?: string; description?: string },
  source: DiscoverySource
): CandidateContent | null {
  if (!result.url) return null;
  const handle = hostnameHandle(result.url);
  if (!handle) return null;

  return {
    platform,
    contentType: "image",
    contentUrl: result.url,
    authorHandle: `@${handle}`,
    caption: [result.title, result.description].filter(Boolean).join("\n\n").slice(0, 2000),
    discoverySource: source,
    authorMeta: {
      platformUserId: null,
      displayName: handle,
      followerCount: null,
      verified: false,
    },
    signals: {
      faceEmbeddingSimilarity: null,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: null,
      // SERPs carry no publish date or reach figures; report nothing rather
      // than guess.
      postedDaysAgo: 0,
      viewCount: 0,
    },
  };
}

export interface SerpDiscoveryResult {
  candidates: CandidateContent[];
  queriesRun: number;
  queriesFailed: number;
  costUsd: number;
  budgetStopped: string | null;
}

export async function discoverSerp(opts: {
  token: string;
  platform: SerpPlatform;
  anchor: TalentIdentityAnchor;
  resultsPerQuery?: number;
  learnedHashtags?: string[];
  signal?: AbortSignal;
  budget?: ActorBudget;
}): Promise<SerpDiscoveryResult> {
  const queries = buildSerpQueries(opts.platform, opts.anchor, opts.learnedHashtags ?? []);
  const mode = `${opts.platform}_serp`;
  const empty: SerpDiscoveryResult = {
    candidates: [],
    queriesRun: 0,
    queriesFailed: 0,
    costUsd: 0,
    budgetStopped: null,
  };
  if (!queries.length) return empty;

  if (opts.budget) {
    const verdict = await opts.budget.check();
    if (!verdict.ok) {
      return { ...empty, budgetStopped: verdict.reason ?? "Apify spend limit reached" };
    }
  }

  const queryLabel = queries.join("; ");
  try {
    const run = await runActor<SerpPageItem>({
      token: opts.token,
      actorId: SERP_ACTOR,
      input: {
        queries: queries.join("\n"),
        resultsPerPage: opts.resultsPerQuery ?? 20,
        maxPagesPerQuery: 1,
      },
      signal: opts.signal,
    });

    const candidates: CandidateContent[] = [];
    const seen = new Set<string>();
    let resultCount = 0;
    for (const page of run.items) {
      const term = page.searchQuery?.term ?? queryLabel;
      const source: DiscoverySource = { mode: "hashtag", query: `${opts.platform}:${term}` };
      for (const result of page.organicResults ?? []) {
        resultCount++;
        const mapped = mapSerpResult(opts.platform, result, source);
        if (mapped && !seen.has(mapped.contentUrl)) {
          seen.add(mapped.contentUrl);
          candidates.push(mapped);
        }
      }
    }

    await opts.budget?.record({
      runId: run.runId,
      actorId: SERP_ACTOR,
      mode,
      query: queryLabel,
      itemCount: resultCount,
      costUsd: run.costUsd,
      status: "succeeded",
      // One actor run, several terms: the spend ledger books it once, the
      // sweep's query log lists the terms it actually asked for.
      platform: opts.platform,
      queries,
    });

    return {
      candidates,
      queriesRun: queries.length,
      queriesFailed: 0,
      costUsd: effectiveRunCost(run.costUsd, resultCount).costUsd,
      budgetStopped: null,
    };
  } catch (err) {
    const apifyErr = err instanceof ApifyError ? err : null;
    if (apifyErr?.runId) {
      await opts.budget?.record({
        runId: apifyErr.runId,
        actorId: SERP_ACTOR,
        mode,
        query: queryLabel,
        itemCount: 0,
        costUsd: apifyErr.costUsd,
        status: "failed",
        error: apifyErr.reason,
        platform: opts.platform,
        queries,
      });
    }
    return {
      ...empty,
      queriesRun: queries.length,
      queriesFailed: queries.length,
      costUsd: apifyErr?.costUsd ?? 0,
    };
  }
}
