/**
 * Reddit discovery via Reddit's own API — the free replacement for the paid
 * Apify actor in ingest/reddit.ts.
 *
 * Client-credentials OAuth rather than the unauthenticated .json endpoints:
 * those are blocked from datacenter egress (which is what a Cloudflare Worker
 * looks like), while oauth.reddit.com with a registered app and a descriptive
 * User-Agent is the sanctioned route. Free tier is 100 queries/min; a sweep
 * issues three.
 *
 * Candidates come out in exactly the shape ingest/reddit.ts produces — same
 * caption ordering, same discoverySource format — so nothing downstream can
 * tell which transport ran. Budget treatment follows the YouTube precedent:
 * no ActorBudget, no apify_usage rows, per-query entries in the sweep's query
 * log via onQuery.
 */

import type { CandidateContent, DiscoverySource, TalentIdentityAnchor } from "../types";
import { buildRedditQueries } from "./reddit";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const SEARCH_URL = "https://oauth.reddit.com/search";

/** Reddit requires a descriptive UA; a generic one gets throttled hard. */
const USER_AGENT = "web:image-vault-likeness-monitor:v1 (likeness protection; imagevault.ai)";

const FETCH_TIMEOUT_MS = 15_000;

export interface RedditCredentials {
  clientId: string;
  clientSecret: string;
}

export function redditCredentials(env?: {
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
}): RedditCredentials | null {
  const clientId = env?.REDDIT_CLIENT_ID?.trim() || process.env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = env?.REDDIT_CLIENT_SECRET?.trim() || process.env.REDDIT_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export type RedditApiFailureReason = "auth" | "rate_limited" | "network" | "bad_response";

export class RedditApiError extends Error {
  constructor(
    message: string,
    public readonly reason: RedditApiFailureReason
  ) {
    super(message);
    this.name = "RedditApiError";
  }
}

function reasonForStatus(status: number): RedditApiFailureReason {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  return "bad_response";
}

async function getAppToken(creds: RedditCredentials, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
      signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new RedditApiError(`Reddit token request failed: ${(err as Error).message}`, "network");
  }
  if (!res.ok) {
    throw new RedditApiError(`Reddit token request returned ${res.status}`, reasonForStatus(res.status));
  }
  const json = (await res.json().catch(() => null)) as { access_token?: string } | null;
  if (!json?.access_token) {
    throw new RedditApiError("Reddit token response had no access_token", "bad_response");
  }
  return json.access_token;
}

/** The subset of a t3 (link) listing child's data we rely on. */
interface RedditApiPost {
  permalink?: string;
  url?: string;
  author?: string;
  author_fullname?: string;
  subreddit?: string;
  title?: string;
  selftext?: string;
  created_utc?: number;
  ups?: number;
  over_18?: boolean;
  stickied?: boolean;
  thumbnail?: string;
  preview?: { images?: Array<{ source?: { url?: string } }> };
}

function daysAgoUnix(seconds?: number): number {
  if (!seconds || !Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.floor((Date.now() / 1000 - seconds) / 86_400));
}

/**
 * The listing's `thumbnail` field doubles as a status flag: "self",
 * "default", "nsfw", "spoiler" and "" all mean "no thumbnail". The preview
 * block, when present, is the real image. Search requests pass raw_json=1 so
 * strings arrive unescaped; the &amp; decode stays as belt-and-braces for
 * payloads (and test fixtures) captured without it.
 */
function thumbnailFor(post: RedditApiPost): string | null {
  const preview = post.preview?.images?.[0]?.source?.url;
  if (preview) return preview.replace(/&amp;/g, "&");
  const thumb = post.thumbnail;
  return thumb && /^https?:\/\//.test(thumb) ? thumb : null;
}

export function mapRedditApiItem(post: RedditApiPost, source: DiscoverySource): CandidateContent | null {
  const handle = post.author?.replace(/^u\//, "").trim();
  if (!handle || handle === "[deleted]") return null;
  const url = post.permalink ? `https://www.reddit.com${post.permalink}` : post.url;
  if (!url) return null;

  const subreddit = post.subreddit?.trim().toLowerCase();

  return {
    platform: "reddit",
    contentType: "post",
    contentUrl: url,
    authorHandle: `@${handle}`,
    // The subreddit leads the caption, same as the Apify mapper: r/SFWdeepfakes
    // is often stronger intent evidence than the post title itself.
    caption: [subreddit ? `[r/${subreddit}]` : null, post.title, post.selftext]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 2000),
    hashtags: subreddit ? [subreddit] : [],
    nsfw: post.over_18 === true,
    media: { thumbnailUrl: thumbnailFor(post), videoUrl: null },
    discoverySource: source,
    authorMeta: {
      platformUserId: post.author_fullname ?? null,
      displayName: handle,
      followerCount: null,
      verified: false,
    },
    signals: {
      faceEmbeddingSimilarity: null,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: null,
      postedDaysAgo: daysAgoUnix(post.created_utc),
      viewCount: post.ups ?? 0,
    },
  };
}

export interface RedditApiQueryReport {
  query: string;
  itemCount: number;
  status: "succeeded" | "failed";
  error?: string;
}

export interface RedditApiDiscoveryResult {
  candidates: CandidateContent[];
  queriesRun: number;
  queriesFailed: number;
}

export async function discoverRedditApi(opts: {
  creds: RedditCredentials;
  anchor: TalentIdentityAnchor;
  maxQueries?: number;
  resultsPerQuery?: number;
  signal?: AbortSignal;
  onQuery?: (report: RedditApiQueryReport) => void;
}): Promise<RedditApiDiscoveryResult> {
  const queries = buildRedditQueries(opts.anchor, opts.maxQueries ?? 3);
  const resultsLimit = Math.min(100, opts.resultsPerQuery ?? 40);
  const candidates: CandidateContent[] = [];
  const seen = new Set<string>();
  let queriesRun = 0;
  let queriesFailed = 0;

  if (!queries.length) return { candidates, queriesRun, queriesFailed };

  // One token per sweep; auth failure here fails every query identically, so
  // it surfaces once as the module's error rather than three times below.
  const token = await getAppToken(opts.creds, opts.signal);

  for (const query of queries) {
    queriesRun++;
    try {
      const params = new URLSearchParams({
        q: query,
        sort: "new",
        limit: String(resultsLimit),
        type: "link",
        // Misuse skews adult; filtering NSFW out would blind the sweep to
        // exactly the content the monitor exists to find.
        include_over_18: "on",
        raw_json: "1",
      });
      let res: Response;
      try {
        res = await fetch(`${SEARCH_URL}?${params}`, {
          headers: { authorization: `Bearer ${token}`, "user-agent": USER_AGENT },
          signal: opts.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
      } catch (err) {
        throw new RedditApiError(`Reddit search failed: ${(err as Error).message}`, "network");
      }
      if (!res.ok) {
        throw new RedditApiError(`Reddit search returned ${res.status}`, reasonForStatus(res.status));
      }
      const json = (await res.json().catch(() => null)) as {
        data?: { children?: Array<{ kind?: string; data?: RedditApiPost }> };
      } | null;

      const source: DiscoverySource = { mode: "hashtag", query: `reddit:${query}` };
      let itemCount = 0;
      for (const child of json?.data?.children ?? []) {
        if (child.kind && child.kind !== "t3") continue;
        if (!child.data || child.data.stickied) continue;
        itemCount++;
        const mapped = mapRedditApiItem(child.data, source);
        if (mapped && !seen.has(mapped.contentUrl)) {
          seen.add(mapped.contentUrl);
          candidates.push(mapped);
        }
      }
      opts.onQuery?.({ query, itemCount, status: "succeeded" });
    } catch (err) {
      queriesFailed++;
      const reason = err instanceof RedditApiError ? err.reason : "network";
      opts.onQuery?.({ query, itemCount: 0, status: "failed", error: reason });
      // Rate-limit and auth failures hit every remaining query identically;
      // stop paying the latency cost of proving that.
      if (reason === "rate_limited" || reason === "auth") break;
    }
  }

  return { candidates, queriesRun, queriesFailed };
}
