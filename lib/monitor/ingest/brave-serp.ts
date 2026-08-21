/**
 * SERP discovery via the Brave Search API — the free replacement for the paid
 * Apify google-search-scraper in ingest/serp.ts, serving the same two
 * registry platforms ("google" and "getty").
 *
 * Query building and result mapping are borrowed wholesale from serp.ts, so
 * this is a transport swap: same site:-scoped getty queries, same
 * hostname-as-handle candidates, same discoverySource strings. Unlike the
 * batched actor run, Brave answers one query per request — which means the
 * query log gets a real per-term result count instead of the batched run's
 * null.
 *
 * Free tier: 2,000 queries/month at 1 request/second. The monthly counter
 * lives in ai_settings (bumpBraveUsage) as an early warning; the sweep-level
 * caller decides nothing on it beyond a console warning, because at ~6
 * queries per sweep the tier covers hundreds of sweeps. Budget treatment is
 * the YouTube precedent: no ActorBudget, no apify_usage rows.
 */

import { getDb } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { CandidateContent, DiscoverySource, TalentIdentityAnchor } from "../types";
import { buildSerpQueries, mapSerpResult, type SerpPlatform } from "./serp";

type Db = ReturnType<typeof getDb>;

const SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const FETCH_TIMEOUT_MS = 15_000;
/** Free tier is 1 req/s; the spacer keeps sequential queries safely under it. */
const QUERY_SPACING_MS = 1_100;

export const BRAVE_MONTH_KEY = "brave_search_month";
export const BRAVE_COUNT_KEY = "brave_search_count";
export const BRAVE_FREE_TIER_MONTHLY = 2_000;

export function braveKey(env?: { BRAVE_SEARCH_API_KEY?: string }): string | null {
  return env?.BRAVE_SEARCH_API_KEY?.trim() || process.env.BRAVE_SEARCH_API_KEY?.trim() || null;
}

/** The subset of Brave's web-search response we rely on. */
interface BraveSearchResponse {
  web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
}

export interface BraveQueryReport {
  query: string;
  itemCount: number;
  status: "succeeded" | "failed";
  error?: string;
}

export interface BraveSerpDiscoveryResult {
  candidates: CandidateContent[];
  queriesRun: number;
  queriesFailed: number;
}

export async function discoverBraveSerp(opts: {
  apiKey: string;
  platform: SerpPlatform;
  anchor: TalentIdentityAnchor;
  resultsPerQuery?: number;
  learnedHashtags?: string[];
  signal?: AbortSignal;
  onQuery?: (report: BraveQueryReport) => void;
}): Promise<BraveSerpDiscoveryResult> {
  const queries = buildSerpQueries(opts.platform, opts.anchor, opts.learnedHashtags ?? []);
  const candidates: CandidateContent[] = [];
  const seen = new Set<string>();
  let queriesRun = 0;
  let queriesFailed = 0;

  for (const query of queries) {
    if (queriesRun > 0) await new Promise((r) => setTimeout(r, QUERY_SPACING_MS));
    queriesRun++;
    try {
      const params = new URLSearchParams({
        q: query,
        count: String(Math.min(20, opts.resultsPerQuery ?? 20)),
      });
      const res = await fetch(`${SEARCH_URL}?${params}`, {
        headers: { "X-Subscription-Token": opts.apiKey, accept: "application/json" },
        signal: opts.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        queriesFailed++;
        opts.onQuery?.({ query, itemCount: 0, status: "failed", error: `http_${res.status}` });
        // 429 (rate/quota) and auth failures hit every remaining query
        // identically; stop rather than prove it per term.
        if (res.status === 429 || res.status === 401 || res.status === 403) break;
        continue;
      }
      const json = (await res.json().catch(() => null)) as BraveSearchResponse | null;
      const source: DiscoverySource = { mode: "hashtag", query: `${opts.platform}:${query}` };
      let itemCount = 0;
      for (const result of json?.web?.results ?? []) {
        itemCount++;
        const mapped = mapSerpResult(opts.platform, result, source);
        if (mapped && !seen.has(mapped.contentUrl)) {
          seen.add(mapped.contentUrl);
          candidates.push(mapped);
        }
      }
      opts.onQuery?.({ query, itemCount, status: "succeeded" });
    } catch (err) {
      queriesFailed++;
      opts.onQuery?.({ query, itemCount: 0, status: "failed", error: (err as Error).message });
    }
  }

  return { candidates, queriesRun, queriesFailed };
}

/**
 * Bump the monthly query counter, resetting when the UTC month rolls over.
 * Returns the month's running total so the caller can warn near the tier
 * ceiling. Best-effort: a lost increment costs accuracy, never coverage.
 */
export async function bumpBraveUsage(db: Db, queryCount: number): Promise<number> {
  const month = new Date().toISOString().slice(0, 7);
  const now = Math.floor(Date.now() / 1000);
  const [monthRow, countRow] = await Promise.all([
    db.select({ value: aiSettings.value }).from(aiSettings).where(eq(aiSettings.key, BRAVE_MONTH_KEY)).get(),
    db.select({ value: aiSettings.value }).from(aiSettings).where(eq(aiSettings.key, BRAVE_COUNT_KEY)).get(),
  ]);
  const sameMonth = monthRow?.value === month;
  const total = (sameMonth ? parseInt(countRow?.value ?? "0", 10) || 0 : 0) + queryCount;

  const upsert = async (key: string, value: string, exists: boolean) => {
    if (exists) {
      await db.update(aiSettings).set({ value, updatedAt: now }).where(eq(aiSettings.key, key));
    } else {
      await db.insert(aiSettings).values({ key, value, updatedAt: now });
    }
  };
  await upsert(BRAVE_MONTH_KEY, month, !!monthRow);
  await upsert(BRAVE_COUNT_KEY, String(total), !!countRow);
  return total;
}
