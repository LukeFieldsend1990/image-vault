/**
 * Instagram discovery: Apify actor output → adjudicable candidates.
 *
 * Two stages, and the order matters economically. Mapping is free; the
 * pre-filter is free; everything after this file costs money per item (AI
 * adjudication now, Rekognition and Hive later). So every drop we can justify
 * in pure code, we make here.
 *
 * The filter is deliberately conservative in one direction only: the allowlist
 * is checked before anything else, because flagging a studio's own trailer or
 * the talent's own post is the single most damaging thing this feature can do.
 */

import type {
  CandidateContent,
  CandidateAuthorMeta,
  DiscoverySource,
  MonitorScope,
  TalentIdentityAnchor,
} from "../types";
import type { HitContentType } from "../platforms";
import { ACTORS, ApifyError, runActor } from "./apify";
import { effectiveRunCost } from "./budget";
import { vigilanceMatch } from "../vigilance";
import {
  buildDiscoveryPlan,
  hasAiIntent,
  hashtagsHaveAiIntent,
  nameVariants,
  queryImpliesAiIntent,
  type DiscoveryPlanOptions,
  type DiscoveryQuery,
} from "./queries";

/** The subset of Apify's Instagram item shape we rely on. */
interface ApifyInstagramItem {
  url?: string;
  shortCode?: string;
  type?: string;
  caption?: string;
  hashtags?: string[];
  timestamp?: string;
  likesCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  displayUrl?: string;
  videoUrl?: string;
  ownerUsername?: string;
  ownerFullName?: string;
  ownerId?: string;
  isVerified?: boolean;
  followersCount?: number;
}

/**
 * Apify's `type` for a post: "Video", "Image", "Sidecar" (carousel).
 *
 * Hashtag sweeps return all three, so hard-coding "reel" would have labelled
 * every still image as video. Reels come through as Video; anything else is a
 * post, which the adjudicator reads as weaker evidence of synthetic *video*
 * misuse — correctly, since a still is a different claim.
 */
function contentTypeFor(type?: string): HitContentType {
  return type === "Video" ? "reel" : "post";
}

function daysAgo(timestamp?: string): number {
  if (!timestamp) return 0;
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/**
 * Map one actor item. Returns null for items with no usable identity — a post
 * we cannot link back to a URL and an author is not actionable evidence.
 */
export function mapInstagramItem(
  item: ApifyInstagramItem,
  source: DiscoverySource
): CandidateContent | null {
  const handle = item.ownerUsername?.trim();
  const url = item.url ?? (item.shortCode ? `https://www.instagram.com/reel/${item.shortCode}/` : null);
  if (!handle || !url) return null;

  const authorMeta: CandidateAuthorMeta = {
    platformUserId: item.ownerId ?? null,
    displayName: item.ownerFullName ?? null,
    followerCount: typeof item.followersCount === "number" ? item.followersCount : null,
    verified: item.isVerified === true,
  };

  return {
    platform: "instagram",
    contentType: contentTypeFor(item.type),
    contentUrl: url,
    authorHandle: `@${handle}`,
    caption: item.caption ?? "",
    hashtags: (item.hashtags ?? []).map((h) => h.replace(/^#/, "").toLowerCase()),
    media: {
      thumbnailUrl: item.displayUrl ?? null,
      videoUrl: item.videoUrl ?? null,
    },
    authorMeta,
    discoverySource: source,
    signals: {
      // Stage 2 / Stage 3 / pHash index all still to land — null, never zero.
      faceEmbeddingSimilarity: null,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: null,
      postedDaysAgo: daysAgo(item.timestamp),
      viewCount: item.videoPlayCount ?? item.videoViewCount ?? item.likesCount ?? 0,
    },
  };
}

export type DropReason = "allowlisted" | "no_name_match" | "no_ai_intent" | "seen_before" | "duplicate";

export interface PreFilterOptions {
  anchor: TalentIdentityAnchor;
  scope: MonitorScope;
  /** Handles that can never be flagged: the talent, their agency, studios, press. */
  allowlist?: string[];
  /** Content URLs already recorded as hits or dismissed for this talent. */
  seenUrls?: Set<string>;
}

export interface PreFilterResult {
  kept: CandidateContent[];
  dropped: Record<DropReason, number>;
}

function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * The gate between free discovery and paid analysis.
 *
 * Order is chosen so the cheapest and most consequential checks run first:
 * allowlist (correctness), then name match (relevance), then AI intent (scope),
 * then dedupe (spend).
 */
export function preFilter(
  candidates: CandidateContent[],
  opts: PreFilterOptions
): PreFilterResult {
  const variants = nameVariants(opts.anchor.fullName).map(normalise);
  const vigilance = opts.anchor.vigilance ?? null;
  const allow = new Set((opts.allowlist ?? []).map((h) => h.replace(/^@/, "").trim().toLowerCase()));
  const seen = opts.seenUrls ?? new Set<string>();
  const withinSweep = new Set<string>();

  const dropped: Record<DropReason, number> = {
    allowlisted: 0,
    no_name_match: 0,
    no_ai_intent: 0,
    seen_before: 0,
    duplicate: 0,
  };
  const kept: CandidateContent[] = [];

  for (const c of candidates) {
    const handle = c.authorHandle.replace(/^@/, "").toLowerCase();
    if (allow.has(handle)) {
      dropped.allowlisted++;
      continue;
    }

    const haystack = normalise([c.caption, c.authorHandle, (c.hashtags ?? []).join(" ")].join(" "));
    // Name match, widened by an open announcement window. A synthetic reel made
    // the week a role is announced routinely never names the actor — it names
    // the character — so during a window a corroborated persona reference
    // (compound tag, or character *and* production together) is accepted as
    // identity evidence. Outside a window this is exactly the old test.
    const vigilanceHit = vigilance ? vigilanceMatch(haystack, vigilance) : { matched: false as const, term: null };
    if (variants.length && !variants.some((v) => haystack.includes(v)) && !vigilanceHit.matched) {
      dropped.no_name_match++;
      continue;
    }

    // Three independent routes to AI intent: the prose, the tags, and the query
    // that found it. An account whose caption says nothing but which was pulled
    // out of #tomhardydeepfake has still declared itself.
    const aiIntent =
      hasAiIntent(c.caption, c.authorHandle) ||
      hashtagsHaveAiIntent(c.hashtags) ||
      queryImpliesAiIntent(c.discoverySource?.query);
    if (opts.scope === "ai_only" && !aiIntent) {
      dropped.no_ai_intent++;
      continue;
    }

    if (seen.has(c.contentUrl)) {
      dropped.seen_before++;
      continue;
    }
    if (withinSweep.has(c.contentUrl)) {
      dropped.duplicate++;
      continue;
    }

    withinSweep.add(c.contentUrl);
    // Carry *why* it survived. When the window supplied the identity match, the
    // adjudicator needs to know the evidence is role vocabulary rather than the
    // actor's name — and it is the only way to tell later whether windows are
    // earning the spend they add.
    kept.push(vigilanceHit.matched ? { ...c, vigilanceMatchTerm: vigilanceHit.term } : c);
  }

  return { kept, dropped };
}

export interface DiscoveryDiagnostics {
  queriesRun: number;
  queriesFailed: number;
  itemsDiscovered: number;
  dropped: Record<DropReason, number>;
  /** Populated when every query failed — surfaced as the scan error. */
  fatalError: string | null;
  /** Spend booked by this sweep, in USD. */
  costUsd: number;
  /** Set when the spend ceiling cut the sweep short. */
  budgetStopped: string | null;
}

export interface DiscoverInstagramOptions extends PreFilterOptions, DiscoveryPlanOptions {
  token: string;
  /** Per-run ceiling handed to Apify, so a runaway actor cannot bill freely. */
  maxItemsPerQuery?: number;
  signal?: AbortSignal;
  /**
   * Spend gate. Consulted before every single run — a sweep issues up to a
   * dozen, so checking once at the top would let one sweep overshoot the
   * ceiling by eleven runs. Omit only in tests.
   */
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
}

function actorInputFor(query: DiscoveryQuery): { actorId: string; input: Record<string, unknown> } | null {
  switch (query.mode) {
    case "hashtag":
      return {
        actorId: ACTORS.hashtag,
        input: { hashtags: [query.value], resultsLimit: query.resultsLimit },
      };
    case "user_search":
      return {
        actorId: ACTORS.search,
        input: { search: query.value, searchType: "user", resultsLimit: query.resultsLimit },
      };
    case "account":
      return {
        actorId: ACTORS.profile,
        input: {
          directUrls: [`https://www.instagram.com/${query.value}/`],
          resultsType: "posts",
          resultsLimit: query.resultsLimit,
        },
      };
    default:
      return null;
  }
}

/**
 * Run this talent's discovery plan and return adjudicable candidates.
 *
 * Individual query failures are absorbed — a dead hashtag actor should not
 * abort a sweep that four other queries are servicing. Only a total wipeout
 * surfaces as a fatal error, because that is the case where reporting "0 hits"
 * would be a lie about coverage rather than a finding.
 */
export async function discoverInstagram(
  opts: DiscoverInstagramOptions
): Promise<{ candidates: CandidateContent[]; diagnostics: DiscoveryDiagnostics }> {
  const plan = buildDiscoveryPlan(opts.anchor, {
    watchedHandles: opts.watchedHandles,
    maxQueries: opts.maxQueries,
    resultsPerQuery: opts.resultsPerQuery,
  });

  const raw: CandidateContent[] = [];
  let queriesFailed = 0;
  let queriesRun = 0;
  let costUsd = 0;
  let budgetStopped: string | null = null;
  const failures: string[] = [];

  for (const query of plan) {
    const spec = actorInputFor(query);
    if (!spec) continue;

    // Gate immediately before each run, never once for the sweep.
    if (opts.budget) {
      const verdict = await opts.budget.check();
      if (!verdict.ok) {
        budgetStopped = verdict.reason ?? "Apify spend limit reached";
        break;
      }
    }

    queriesRun++;
    try {
      const run = await runActor<ApifyInstagramItem>({
        token: opts.token,
        actorId: spec.actorId,
        input: spec.input,
        maxItems: opts.maxItemsPerQuery ?? query.resultsLimit,
        signal: opts.signal,
      });
      const source: DiscoverySource = { mode: query.mode, query: query.value };
      for (const item of run.items) {
        const mapped = mapInstagramItem(item, source);
        if (mapped) raw.push(mapped);
      }
      await opts.budget?.record({
        runId: run.runId,
        actorId: spec.actorId,
        mode: query.mode,
        query: query.value,
        itemCount: run.items.length,
        costUsd: run.costUsd,
        status: "succeeded",
      });
      costUsd += effectiveRunCost(run.costUsd, run.items.length).costUsd;
    } catch (err) {
      queriesFailed++;
      const apifyErr = err instanceof ApifyError ? err : null;
      failures.push(
        apifyErr ? `${query.mode}:${query.value} → ${apifyErr.reason}` : `${query.mode}:${query.value}`
      );

      // A run that started and then failed still consumed compute. Booking only
      // successes would let repeated failures spend past the ceiling unseen.
      if (apifyErr?.runId) {
        await opts.budget?.record({
          runId: apifyErr.runId,
          actorId: spec.actorId,
          mode: query.mode,
          query: query.value,
          itemCount: 0,
          costUsd: apifyErr.costUsd,
          status: "failed",
          error: apifyErr.reason,
        });
        costUsd += apifyErr.costUsd ?? 0; // failed runs return no items to estimate from
      }

      // An auth or out-of-credits failure will hit every remaining query
      // identically; stop paying the latency cost of proving that. Credits
      // exhaustion reads as a coverage stop, same as the internal ceiling.
      if (apifyErr?.reason === "credits") {
        budgetStopped = "Apify account out of credits";
        break;
      }
      if (apifyErr?.reason === "auth") break;
    }
  }

  const { kept, dropped } = preFilter(raw, opts);

  return {
    candidates: kept,
    diagnostics: {
      queriesRun,
      queriesFailed,
      itemsDiscovered: raw.length,
      dropped,
      costUsd,
      budgetStopped,
      // "Every query failed" only counts queries we actually attempted. A sweep
      // halted by the budget before its first run is a budget problem, and
      // saying so is more useful than claiming discovery broke.
      fatalError:
        budgetStopped && queriesRun === 0
          ? budgetStopped
          : queriesRun > 0 && queriesFailed === queriesRun
            ? `All ${queriesRun} discovery queries failed (${failures.slice(0, 3).join("; ")})`
            : null,
    },
  };
}
