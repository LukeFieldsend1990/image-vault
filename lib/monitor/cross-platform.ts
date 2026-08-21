/**
 * Cross-platform sibling accounts.
 *
 * The people running these accounts are building an audience, not a single
 * feed: @ultimatestudiosofficial posts the same AI trailer to Instagram and
 * TikTok under the same name. Finding one of them and stopping there leaves
 * the same content live on the platform we did not look at, and leaves the
 * reach — which is the thing that actually has to be killed — mostly intact.
 *
 * So once an account proves it matters, we go looking for its twins:
 *
 *  1. **Only the accounts worth the spend.** Probing every watchlist handle on
 *     every other platform is a multiplier on Apify cost for very little
 *     return — most of the list is small. Only accounts in the top quartile by
 *     reach get probed, so the spend follows the damage.
 *  2. **Name first.** Crossposters reuse the handle, near enough: dots and
 *     underscores move around, "official" gets appended. That yields a short,
 *     cheap candidate list per platform.
 *  3. **Content second.** A matching name is a lead, not a finding — plenty of
 *     handles collide across platforms. A lead is only confirmed when the
 *     account's posts look like the posts we already flagged on the source
 *     platform: same captions, same hashtags. Everything else is recorded as a
 *     name-only lead for a human to judge.
 *
 * Confirmed siblings are added to the shared watchlist, which means the next
 * sweep harvests them like any other watched account and their posts go
 * through the same pre-filter and adjudicator. Nothing here flags anything on
 * its own.
 */

import { getDb } from "@/lib/db";
import { monitorAccounts, monitorAccountLinks, likenessHits } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ACTORS, ApifyError, runActor, type ActorBudget } from "./ingest/apify";
import { resolveActorConfig } from "./ingest/actor-settings";
import { profileActorInput } from "./ingest/instagram";
import { TIKTOK_ACTOR, tiktokProfileInput } from "./ingest/tiktok";
import { X_ACTOR } from "./ingest/x";
import { normaliseHandle } from "./ingest/follows";

type Db = ReturnType<typeof getDb>;

/** Platforms an account can have a sibling on. Kept to the four where a
 *  handle is the account's public identity — Google, Getty and the AI
 *  platforms have no equivalent. */
export const SIBLING_PLATFORMS = ["instagram", "tiktok", "youtube", "x"] as const;
export type SiblingPlatform = (typeof SIBLING_PLATFORMS)[number];

export function isSiblingPlatform(p: string): p is SiblingPlatform {
  return (SIBLING_PLATFORMS as readonly string[]).includes(p);
}

// ── Selection ────────────────────────────────────────────────────────────────

export interface ReachAccount {
  id: string;
  platform: string;
  handle: string;
  cumulativeViews: number;
  followerCount: number | null;
}

/**
 * How big is this account, in one number? Views on flagged posts is the
 * measure we care about, but a freshly imported account has none yet, and its
 * follower count is the only signal available. Followers are discounted
 * heavily: an account with a million followers and no flagged views has not
 * done anything to us yet.
 */
export function reachOf(account: Pick<ReachAccount, "cumulativeViews" | "followerCount">): number {
  return account.cumulativeViews > 0 ? account.cumulativeViews : Math.round((account.followerCount ?? 0) / 10);
}

/**
 * The top slice by reach, biggest first. Selected by count rather than by a
 * percentile threshold: "the top 25%" should mean a quarter of the list, and a
 * nearest-rank threshold on a short list quietly lets half of it through.
 * Accounts with no reach at all never qualify.
 */
export function topByReach<T extends Pick<ReachAccount, "cumulativeViews" | "followerCount">>(
  accounts: T[],
  fraction = 0.25
): T[] {
  const withReach = accounts.filter((a) => reachOf(a) > 0).sort((a, b) => reachOf(b) - reachOf(a));
  if (!withReach.length) return [];
  return withReach.slice(0, Math.max(1, Math.ceil(withReach.length * fraction)));
}

/** Handle spellings worth probing, most likely first. Crossposters keep the
 *  name and lose the punctuation, or bolt "official" on the end. */
export function handleVariants(handle: string): string[] {
  const base = handle.trim().toLowerCase().replace(/^@/, "");
  // Junk in, nothing out: a two-character handle is not a handle, and padding
  // it into "aiofficial" would probe an account with no relation to this one.
  if (base.length < 3 || base.length > 30) return [];
  const stripped = base.replace(/[._-]/g, "");
  const variants = [base, stripped, `${stripped}official`, `${stripped}_official`];
  return [...new Set(variants.filter((v) => v.length >= 3 && v.length <= 30))];
}

export interface SiblingTarget {
  sourceAccountId: string;
  sourceHandle: string;
  sourcePlatform: string;
  platform: SiblingPlatform;
  /** Handle spellings to probe on that platform, most likely first. */
  candidates: string[];
}

/**
 * Which accounts get probed, and where. Top quartile by reach, skipping any
 * platform where a handle we would probe is already on the books — that
 * account is already being swept, and re-probing it is spend for nothing.
 */
export function selectSiblingTargets(
  accounts: ReachAccount[],
  opts: { fraction?: number; platforms?: readonly SiblingPlatform[]; limit?: number } = {}
): SiblingTarget[] {
  const platforms = opts.platforms ?? SIBLING_PLATFORMS;
  const known = new Set(accounts.map((a) => `${a.platform}:${a.handle.toLowerCase()}`));
  const ranked = topByReach(accounts, opts.fraction ?? 0.25);

  const targets: SiblingTarget[] = [];
  for (const account of ranked) {
    for (const platform of platforms) {
      if (platform === account.platform) continue;
      const candidates = handleVariants(account.handle).filter(
        (h) => !known.has(`${platform}:${h}`)
      );
      if (!candidates.length) continue;
      targets.push({
        sourceAccountId: account.id,
        sourcePlatform: account.platform,
        sourceHandle: account.handle,
        platform,
        candidates,
      });
    }
  }
  return opts.limit ? targets.slice(0, opts.limit) : targets;
}

// ── Content matching ─────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "your", "you", "our", "are", "was",
  "new", "out", "now", "all", "not", "but", "his", "her", "they", "them", "who", "what",
]);

/** Caption reduced to the tokens worth comparing: words and hashtags, minus
 *  noise. Emoji and punctuation carry no signal for crosspost matching. */
export function captionTokens(caption: string | null | undefined): Set<string> {
  if (!caption) return new Set();
  const tokens = caption
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9#\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t.replace(/^#/, "")));
  return new Set(tokens);
}

/** Jaccard overlap of two captions, 0-1. Crossposted captions are usually
 *  identical or near enough; an unrelated account sharing a handle is not. */
export function captionSimilarity(a: string | null, b: string | null): number {
  const ta = captionTokens(a);
  const tb = captionTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** A caption pair at or above this overlap is the same post, republished. */
export const CROSSPOST_SIMILARITY = 0.5;

export interface ProbedPost {
  url: string;
  caption: string | null;
}

export interface SiblingEvidence {
  /** Posts on the probed account that match a flagged post on the source. */
  matchedPosts: number;
  /** Best caption overlap seen, 0-1. */
  bestSimilarity: number;
  /** Sample of the matching URLs, for the admin panel. */
  examples: string[];
}

/**
 * Compare a probed account's posts against the captions we already flagged on
 * the source account. Confirmation is content-based on purpose: a shared
 * handle across platforms is common enough that name alone would put innocent
 * accounts on a watchlist.
 */
export function scoreSiblingEvidence(
  sourceCaptions: (string | null)[],
  posts: ProbedPost[]
): SiblingEvidence {
  let matchedPosts = 0;
  let bestSimilarity = 0;
  const examples: string[] = [];

  for (const post of posts) {
    let best = 0;
    for (const caption of sourceCaptions) {
      const score = captionSimilarity(caption, post.caption);
      if (score > best) best = score;
    }
    if (best > bestSimilarity) bestSimilarity = best;
    if (best >= CROSSPOST_SIMILARITY) {
      matchedPosts++;
      if (examples.length < 3) examples.push(post.url);
    }
  }

  return { matchedPosts, bestSimilarity: Math.round(bestSimilarity * 100) / 100, examples };
}

// ── Probing ──────────────────────────────────────────────────────────────────

export interface ProbeResult {
  exists: boolean;
  displayName: string | null;
  followerCount: number | null;
  posts: ProbedPost[];
  costUsd: number;
  error: string | null;
}

const EMPTY_PROBE: ProbeResult = {
  exists: false,
  displayName: null,
  followerCount: null,
  posts: [],
  costUsd: 0,
  error: null,
};

/** How many recent posts a probe pulls. Enough to catch a crosspost without
 *  paying for a full harvest of an account that may not even be theirs. */
const PROBE_POSTS = 6;

interface ProbeEnv {
  APIFY_TOKEN?: string;
  YOUTUBE_API_KEY?: string;
}

interface InstagramProbeItem {
  url?: string;
  caption?: string;
  ownerFullName?: string;
  ownerUsername?: string;
  error?: string;
}

interface TikTokProbeItem {
  text?: string;
  webVideoUrl?: string;
  authorMeta?: { name?: string; nickName?: string; fans?: number };
}

interface XProbeItem {
  text?: string;
  url?: string;
  author?: { userName?: string; name?: string; followers?: number };
}

interface YouTubeSearchItem {
  id?: { channelId?: string };
  snippet?: { title?: string; description?: string; channelTitle?: string };
}

/**
 * Does this handle exist on this platform, and what has it posted lately?
 *
 * One actor run per probe, gated on the same Apify budget every other
 * discovery run answers to. A failure is not fatal anywhere: an unprobed lead
 * simply stays pending.
 */
export async function probeHandle(
  env: ProbeEnv,
  platform: SiblingPlatform,
  handle: string,
  budget?: ActorBudget,
  actors?: { profile?: string; tiktok?: string }
): Promise<ProbeResult> {
  if (platform === "youtube") return probeYouTube(env, handle);
  if (!env.APIFY_TOKEN) return { ...EMPTY_PROBE, error: "No Apify token" };

  if (budget) {
    const verdict = await budget.check();
    if (!verdict.ok) return { ...EMPTY_PROBE, error: verdict.reason ?? "Apify spend limit reached" };
  }

  const profileActor = actors?.profile ?? ACTORS.profile;
  const tiktokActor = actors?.tiktok ?? TIKTOK_ACTOR;
  const spec =
    platform === "instagram"
      ? {
          actorId: profileActor,
          input: profileActorInput(profileActor, handle, PROBE_POSTS),
        }
      : platform === "tiktok"
        ? {
            actorId: tiktokActor,
            input: tiktokProfileInput(tiktokActor, handle, PROBE_POSTS),
          }
        : {
            actorId: X_ACTOR,
            input: { searchTerms: [`from:${handle}`], maxItems: PROBE_POSTS, sort: "Latest" },
          };

  try {
    const run = await runActor<InstagramProbeItem & TikTokProbeItem & XProbeItem>({
      token: env.APIFY_TOKEN,
      actorId: spec.actorId,
      input: spec.input,
      maxItems: PROBE_POSTS,
    });
    await budget?.record({
      runId: run.runId,
      actorId: spec.actorId,
      mode: `sibling_probe_${platform}`,
      query: handle,
      itemCount: run.items.length,
      costUsd: run.costUsd,
      status: "succeeded",
    });

    const posts: ProbedPost[] = [];
    let displayName: string | null = null;
    let followerCount: number | null = null;

    for (const item of run.items) {
      if (item.error) continue;
      if (platform === "instagram") {
        if (item.url) posts.push({ url: item.url, caption: item.caption ?? null });
        displayName ??= item.ownerFullName ?? null;
      } else if (platform === "tiktok") {
        // The actor answers a profile query with that profile's videos; a
        // handle that does not exist comes back empty.
        if (item.webVideoUrl) posts.push({ url: item.webVideoUrl, caption: item.text ?? null });
        displayName ??= item.authorMeta?.nickName ?? null;
        followerCount ??= item.authorMeta?.fans ?? null;
      } else {
        // from: search can return retweets by others — keep only the handle's own.
        if (item.url && item.author?.userName?.toLowerCase() === handle.toLowerCase()) {
          posts.push({ url: item.url, caption: item.text ?? null });
          displayName ??= item.author?.name ?? null;
          followerCount ??= item.author?.followers ?? null;
        }
      }
    }

    return {
      exists: posts.length > 0,
      displayName,
      followerCount,
      posts,
      costUsd: run.costUsd ?? 0,
      error: null,
    };
  } catch (err) {
    const apifyErr = err instanceof ApifyError ? err : null;
    if (apifyErr?.runId) {
      await budget?.record({
        runId: apifyErr.runId,
        actorId: spec.actorId,
        mode: `sibling_probe_${platform}`,
        query: handle,
        itemCount: 0,
        costUsd: apifyErr.costUsd,
        status: "failed",
        error: apifyErr.reason,
      });
    }
    return { ...EMPTY_PROBE, costUsd: apifyErr?.costUsd ?? 0, error: (err as Error).message };
  }
}

/** YouTube needs no actor — the Data API answers channel lookups directly, at
 *  100 quota units rather than money. */
async function probeYouTube(env: ProbeEnv, handle: string): Promise<ProbeResult> {
  if (!env.YOUTUBE_API_KEY) return { ...EMPTY_PROBE, error: "No YouTube API key" };
  try {
    const params = new URLSearchParams({
      part: "snippet",
      q: handle,
      type: "channel",
      maxResults: "3",
      key: env.YOUTUBE_API_KEY,
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    if (!res.ok) return { ...EMPTY_PROBE, error: `YouTube search failed (${res.status})` };
    const body = (await res.json()) as { items?: YouTubeSearchItem[] };
    const wanted = handle.replace(/[._-]/g, "");
    const match = (body.items ?? []).find(
      (item) => (item.snippet?.title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") === wanted
    );
    if (!match) return EMPTY_PROBE;
    return {
      exists: true,
      displayName: match.snippet?.title ?? null,
      followerCount: null,
      // search.list returns the channel, not its uploads. Existence is the
      // finding here; the sweep harvests the content once it is watchlisted.
      posts: [],
      costUsd: 0,
      error: null,
    };
  } catch (err) {
    return { ...EMPTY_PROBE, error: (err as Error).message };
  }
}

// ── Orchestration ────────────────────────────────────────────────────────────

export type LinkStatus = "confirmed" | "name_only" | "not_found" | "dismissed";

/**
 * How long a "handle does not exist" answer is trusted before it is worth
 * asking again. Not forever: handles get registered later, and an operator
 * who expands to TikTok next month is exactly the case this layer exists to
 * catch. Long enough that no sweep re-probes the same dead handle in any
 * normal cadence.
 */
export const NEGATIVE_RECHECK_SECONDS = 60 * 24 * 60 * 60; // 60 days

export interface ProbeRecord {
  platform: string;
  handle: string;
  status: LinkStatus;
  checkedAt: number | null;
}

/**
 * Index past probes by what was probed, not by who paid for the probe.
 *
 * Two watched accounts routinely produce the same candidate handle — the same
 * operator shows up under several source accounts, and the variant spellings
 * collapse onto each other. Keyed by source, each of them would pay for its
 * own copy of the same lookup. Keyed by target, the second one is free.
 *
 * Where several records exist for one target, the decisive one wins: an answer
 * about whether the account exists beats a negative, and the most recent
 * negative beats an older one.
 */
export function buildProbeMemory(records: ProbeRecord[]): Map<string, ProbeRecord> {
  const memory = new Map<string, ProbeRecord>();
  for (const record of records) {
    const key = probeKey(record.platform, record.handle);
    const existing = memory.get(key);
    if (!existing) {
      memory.set(key, record);
      continue;
    }
    const decisive = (r: ProbeRecord) => (r.status === "not_found" ? 0 : 1);
    if (
      decisive(record) > decisive(existing) ||
      (decisive(record) === decisive(existing) && (record.checkedAt ?? 0) > (existing.checkedAt ?? 0))
    ) {
      memory.set(key, record);
    }
  }
  return memory;
}

export function probeKey(platform: string, handle: string): string {
  return `${platform}:${handle.toLowerCase()}`;
}

/**
 * Is this handle worth spending a probe on? No, if we already know what it is
 * — confirmed, name-only and dismissed are all settled answers. No, if we
 * looked and found nothing recently. Yes otherwise.
 */
export function shouldProbe(
  memory: Map<string, ProbeRecord>,
  platform: string,
  handle: string,
  now: number
): boolean {
  const record = memory.get(probeKey(platform, handle));
  if (!record) return true;
  if (record.status !== "not_found") return false;
  return now - (record.checkedAt ?? 0) >= NEGATIVE_RECHECK_SECONDS;
}

export interface CrossPlatformStats {
  probed: number;
  confirmed: number;
  nameOnly: number;
  notFound: number;
  /** Candidates we already had an answer for, so no run was paid for. */
  skipped: number;
  costUsd: number;
}

/** Cap per sweep. Each probe is an actor run; a handful per sweep compounds
 *  across every sweep without turning one talent's scan into a spend spike. */
export const MAX_PROBES_PER_SWEEP = 6;

/**
 * Look for siblings of this talent's highest-reach offender accounts.
 *
 * Confirmed siblings — matching handle *and* matching content — are added to
 * the watchlist so the next sweep harvests them. Name-only matches are stored
 * as leads for the admin panel rather than acted on, because a shared handle
 * across two platforms is not evidence of anything by itself.
 */
export async function findCrossPlatformSiblings(
  env: ProbeEnv,
  db: Db,
  opts: {
    talentId: string;
    budget?: ActorBudget;
    platforms?: readonly SiblingPlatform[];
    maxProbes?: number;
  }
): Promise<CrossPlatformStats> {
  const stats: CrossPlatformStats = {
    probed: 0,
    confirmed: 0,
    nameOnly: 0,
    notFound: 0,
    skipped: 0,
    costUsd: 0,
  };

  const accounts = await db
    .select({
      id: monitorAccounts.id,
      platform: monitorAccounts.platform,
      handle: monitorAccounts.handle,
      cumulativeViews: monitorAccounts.cumulativeViews,
      followerCount: monitorAccounts.followerCount,
    })
    .from(monitorAccounts)
    .where(inArray(monitorAccounts.status, ["watchlist", "reported"]))
    .all();

  const targets = selectSiblingTargets(accounts.filter((a) => isSiblingPlatform(a.platform)), {
    platforms: opts.platforms,
  });
  if (!targets.length) return stats;

  // Everything we have ever probed, keyed by what was probed. This is what
  // stops sweeps paying nightly to re-ask a question that already has an
  // answer — including across source accounts, which frequently produce the
  // same candidate handle.
  const memory = buildProbeMemory(
    await db
      .select({
        platform: monitorAccountLinks.platform,
        handle: monitorAccountLinks.handle,
        status: monitorAccountLinks.status,
        checkedAt: monitorAccountLinks.checkedAt,
      })
      .from(monitorAccountLinks)
      .all()
  );

  const maxProbes = opts.maxProbes ?? MAX_PROBES_PER_SWEEP;
  const now = Math.floor(Date.now() / 1000);
  // Probes use the same runtime-swappable actors as the main sweep, so an
  // actor promoted from the admin panel covers this path without a deploy.
  const actorCfg = await resolveActorConfig(db);

  for (const target of targets) {
    if (stats.probed >= maxProbes) break;

    // Captions of this account's flagged posts — the yardstick a probed
    // account's posts are measured against.
    const sourceHits = await db
      .select({ caption: likenessHits.caption })
      .from(likenessHits)
      .where(eq(likenessHits.accountId, target.sourceAccountId))
      .orderBy(desc(likenessHits.detectedAt))
      .limit(20)
      .all();
    const sourceCaptions = sourceHits.map((h) => h.caption);

    for (const candidate of target.candidates) {
      if (stats.probed >= maxProbes) break;
      if (!shouldProbe(memory, target.platform, candidate, now)) {
        stats.skipped++;
        continue;
      }

      const probe = await probeHandle(env, target.platform, candidate, opts.budget, {
        profile: actorCfg.profile,
        tiktok: actorCfg.tiktok,
      });
      if (probe.error && !probe.exists) {
        // A probe we could not run is not a finding — leave it unanswered so a
        // later sweep retries it.
        if (probe.error.includes("limit")) return stats;
        continue;
      }
      stats.probed++;
      stats.costUsd += probe.costUsd;

      const evidence = scoreSiblingEvidence(sourceCaptions, probe.posts);
      const status: LinkStatus = !probe.exists
        ? "not_found"
        : evidence.matchedPosts > 0
          ? "confirmed"
          : "name_only";

      let promotedAccountId: string | null = null;
      if (status === "confirmed") {
        promotedAccountId = await promoteSibling(db, {
          platform: target.platform,
          handle: candidate,
          displayName: probe.displayName,
          followerCount: probe.followerCount,
          note: `Cross-platform sibling of @${target.sourceHandle} on ${target.sourcePlatform} — ${evidence.matchedPosts} matching post(s).`,
          now,
        });
        stats.confirmed++;
      } else if (status === "name_only") {
        stats.nameOnly++;
      } else {
        stats.notFound++;
      }

      memory.set(probeKey(target.platform, candidate), {
        platform: target.platform,
        handle: candidate,
        status,
        checkedAt: now,
      });

      // A re-probe after the negative TTL updates the existing row rather than
      // colliding with the (source, platform, handle) unique constraint.
      const previous = await db
        .select({ id: monitorAccountLinks.id })
        .from(monitorAccountLinks)
        .where(
          and(
            eq(monitorAccountLinks.sourceAccountId, target.sourceAccountId),
            eq(monitorAccountLinks.platform, target.platform),
            eq(monitorAccountLinks.handle, candidate)
          )
        )
        .get();
      const row = {
        status,
        matchedPosts: evidence.matchedPosts,
        bestSimilarity: Math.round(evidence.bestSimilarity * 100),
        evidenceJson: JSON.stringify(evidence.examples),
        promotedAccountId,
        checkedAt: now,
      };
      if (previous) {
        await db.update(monitorAccountLinks).set(row).where(eq(monitorAccountLinks.id, previous.id));
      } else {
        await db.insert(monitorAccountLinks).values({
          id: crypto.randomUUID(),
          sourceAccountId: target.sourceAccountId,
          platform: target.platform,
          handle: candidate,
          discoveredByTalentId: opts.talentId,
          createdAt: now,
          ...row,
        });
      }

      // One confirmed sibling per platform is enough; the remaining spellings
      // are almost certainly the same account or nobody.
      if (status === "confirmed") break;
    }
  }

  return stats;
}

/** Put a confirmed sibling on the shared watchlist. Idempotent — the unique
 *  (platform, handle) constraint means a racing sweep cannot double-add. */
async function promoteSibling(
  db: Db,
  opts: {
    platform: string;
    handle: string;
    displayName: string | null;
    followerCount: number | null;
    note: string;
    now: number;
  }
): Promise<string | null> {
  const existing = await db
    .select({ id: monitorAccounts.id })
    .from(monitorAccounts)
    .where(and(eq(monitorAccounts.platform, opts.platform), eq(monitorAccounts.handle, opts.handle)))
    .get();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  try {
    await db.insert(monitorAccounts).values({
      id,
      platform: opts.platform,
      handle: normaliseHandle(opts.handle) ?? opts.handle,
      displayName: opts.displayName,
      followerCount: opts.followerCount,
      firstSeenAt: opts.now,
      lastSeenAt: opts.now,
      status: "watchlist",
      notes: opts.note,
    });
    return id;
  } catch {
    // Lost the race with another sweep — take whichever row landed.
    const row = await db
      .select({ id: monitorAccounts.id })
      .from(monitorAccounts)
      .where(and(eq(monitorAccounts.platform, opts.platform), eq(monitorAccounts.handle, opts.handle)))
      .get();
    return row?.id ?? null;
  }
}
