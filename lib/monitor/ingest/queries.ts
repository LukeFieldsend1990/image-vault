/**
 * Discovery query planning.
 *
 * Instagram's own app does free-text post search, but that surface is NOT
 * reachable through Apify — probed directly, every free-text combination
 * returns `no_items`. What remains is hashtags and account harvesting.
 *
 *   1. hashtag — the talent's bare name tag and title tags, where the content
 *                actually lives (see buildDiscoveryPlan for why)
 *   2. account — watched offender handles, harvested in full every sweep
 *
 * Mode 2 is where the enforcement value is; mode 1 exists to *find* the
 * accounts that mode 2 then keeps under permanent observation. A synthetic reel
 * is cheap to repost, so the durable unit of detection is the account, not the
 * post.
 *
 * `user_search` is retained in the type but no longer planned: probing showed
 * Apify's user search returns nothing usable, so planning it spent money for
 * no results.
 *
 * Generic AI hashtags (#deepfake, #aivideo) are deliberately NOT part of a
 * per-talent plan — they are swept once for the whole roster and name-matched
 * against every monitored talent, so their cost amortises instead of
 * multiplying. See `rosterHashtagQueries()`.
 */

import type { DiscoveryMode, TalentIdentityAnchor } from "../types";

export interface DiscoveryQuery {
  mode: DiscoveryMode;
  /** Hashtag without '#', user-search string, or profile handle without '@'. */
  value: string;
  resultsLimit: number;
}

/**
 * AI-intent suffixes appended to a name slug to form hashtags. Ordered by
 * observed yield: the first two carry most of the real traffic.
 */
export const AI_HASHTAG_SUFFIXES = [
  "ai",
  "deepfake",
  "aiedit",
  "faceswap",
  "aiart",
] as const;

/**
 * Roster-wide AI hashtags. Swept once, name-matched against every monitored
 * talent in the pre-filter — the one discovery line that gets cheaper per
 * talent as the roster grows.
 */
export const ROSTER_AI_HASHTAGS = [
  "aivideo",
  "deepfake",
  "aiactor",
  "faceswap",
  "aicinema",
  "syntheticmedia",
  "aigenerated",
] as const;

/**
 * Vocabulary that marks a post as *claiming* to be AI. These accounts advertise
 * it — it is their marketing — which is why caption text is a usable AI signal
 * even before a classifier runs. Matched as whole words against caption,
 * handle and hashtags.
 */
export const AI_INTENT_MARKERS = [
  // Explicit AI vocabulary
  "ai",
  "a\\.i\\.",
  "aigenerated",
  "ai-generated",
  "deepfake",
  "deep fake",
  "faceswap",
  "face swap",
  "synthetic",
  "generated",
  "genai",
  "midjourney",
  "sora",
  "veo",
  "runway",
  "kling",
  "heygen",
  "elevenlabs",
  "lora",
  "diffusion",
  "made with ai",
  "ai model",
  "likeness model",
  // Synthetic-content vocabulary that does NOT say "AI".
  // Observed live: a synthetic Venom trailer using Tom Hardy's likeness was
  // captioned "FAN MADE CONCEPT TRAILER" with no mention of AI anywhere. A
  // keyword list built only from AI words would have discarded it before the
  // adjudicator ever saw it, which is the wrong place to be strict — the
  // pre-filter is a cheap recall gate, and precision is the adjudicator's job.
  "concept trailer",
  "fan made",
  "fanmade",
  "fan trailer",
  "fan film",
  "what if",
  "reimagined",
  "recast",
  "unofficial",
] as const;

const AI_INTENT_RE = new RegExp(`(?:^|[^a-z0-9])(?:${AI_INTENT_MARKERS.join("|")})(?:[^a-z0-9]|$)`, "i");

/** Does this prose advertise AI generation? Word-boundary matched. */
export function hasAiIntent(...texts: Array<string | null | undefined>): boolean {
  return texts.some((t) => (t ? AI_INTENT_RE.test(t) : false));
}

/**
 * Markers unambiguous enough to match *inside* a concatenated hashtag.
 * "ai" is excluded here — as a substring it fires on hair, portrait, aim.
 */
const HASHTAG_SUBSTRING_MARKERS = [
  "deepfake",
  "faceswap",
  "aigenerated",
  "synthetic",
  "midjourney",
  "heygen",
  "elevenlabs",
  "diffusion",
  "runway",
] as const;

/**
 * Hashtags are word-boundary-free by construction, so they need their own test:
 * "#tomhardyai" is exactly the signal we are hunting, and a word-boundary regex
 * would miss it. "ai" is accepted only at the start or end of the tag, where it
 * reads as a token rather than as a fragment of "portrait" or "hair".
 */
export function hashtagsHaveAiIntent(tags: string[] | undefined): boolean {
  if (!tags?.length) return false;
  return tags.some((raw) => {
    const tag = raw.replace(/^#/, "").toLowerCase();
    if (tag === "ai" || tag.startsWith("ai") || tag.endsWith("ai")) return true;
    return HASHTAG_SUBSTRING_MARKERS.some((m) => tag.includes(m));
  });
}

/**
 * Did the query that surfaced this item already establish AI intent? A post
 * found under #tomhardydeepfake carries that context even if its own caption
 * is bare — which is common, since the tag does the discovery work for them.
 */
export function queryImpliesAiIntent(query: string | undefined): boolean {
  if (!query) return false;
  return hashtagsHaveAiIntent([query]);
}

/** "Tom Hardy" → "tomhardy". Diacritics folded, punctuation dropped. */
export function nameSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Forms of the talent's name we accept as a match in captions and handles:
 * the full name, the slug, and the dot/underscore handle spellings accounts
 * actually use ("tom.hardy", "tom_hardy").
 */
export function nameVariants(fullName: string): string[] {
  const parts = fullName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return [];
  const slug = parts.join("");
  const variants = new Set<string>([parts.join(" "), slug]);
  if (parts.length > 1) {
    variants.add(parts.join("."));
    variants.add(parts.join("_"));
    variants.add(parts.join("-"));
  }
  return [...variants];
}

export interface WatchlistHarvestInput {
  handle: string;
  /** Unix seconds of the last successful harvest; null if never harvested. */
  lastHarvestedAt: number | null;
}

export interface WatchlistHarvestPlan {
  /** Handles to harvest this sweep, stalest first. */
  handles: string[];
  /** Per-handle ISO date (YYYY-MM-DD) for the actor's onlyPostsNewerThan. */
  newerThan: Record<string, string>;
  /** Handles skipped because their last harvest is within the cooldown. */
  skipped: string[];
}

/**
 * Overlap subtracted from the last-harvest time when asking the actor for
 * "posts newer than" — late-indexed or edited posts near the boundary get a
 * second look, and the pre-filter drops any re-surfaced duplicates for free.
 */
const HARVEST_OVERLAP_SECONDS = 48 * 3600;

/**
 * Decide which watched accounts this sweep actually harvests.
 *
 * Re-scraping every watched handle in full every sweep bills the same posts
 * over and over (observed: identical item counts from the same account across
 * sweeps). Instead: handles inside the cooldown window are skipped, the rest
 * go stalest-first under the cap so the whole watchlist rotates across sweeps,
 * and previously harvested handles carry a newer-than date so the actor only
 * returns (and bills) posts we have not seen.
 */
export function planWatchlistHarvest(
  accounts: WatchlistHarvestInput[],
  opts: { nowUnix: number; cooldownHours: number; cap: number }
): WatchlistHarvestPlan {
  const cutoff = opts.nowUnix - opts.cooldownHours * 3600;

  const seen = new Set<string>();
  const eligible: WatchlistHarvestInput[] = [];
  const skipped: string[] = [];
  for (const a of accounts) {
    const handle = a.handle.replace(/^@/, "").trim().toLowerCase();
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    if (a.lastHarvestedAt !== null && a.lastHarvestedAt > cutoff) {
      skipped.push(handle);
    } else {
      eligible.push({ handle, lastHarvestedAt: a.lastHarvestedAt });
    }
  }

  // Never-harvested first, then oldest harvest first: the cap trims the
  // freshest end, so every account is reached within a few sweeps.
  eligible.sort((a, b) => (a.lastHarvestedAt ?? 0) - (b.lastHarvestedAt ?? 0));
  const chosen = eligible.slice(0, Math.max(0, opts.cap));

  const newerThan: Record<string, string> = {};
  for (const a of chosen) {
    if (a.lastHarvestedAt === null) continue;
    const since = new Date((a.lastHarvestedAt - HARVEST_OVERLAP_SECONDS) * 1000);
    newerThan[a.handle] = since.toISOString().slice(0, 10);
  }

  return { handles: chosen.map((a) => a.handle), newerThan, skipped };
}

export interface DiscoveryPlanOptions {
  /** Watched handles due for harvest this sweep (see planWatchlistHarvest). */
  watchedHandles?: string[];
  /** Cap on total queries, to keep per-sweep spend predictable. */
  maxQueries?: number;
  /** Items requested per query. */
  resultsPerQuery?: number;
}

/**
 * Build this sweep's query plan for one talent.
 *
 * Account watches come first and are never dropped by the budget: a known
 * offender reposting is the highest-value signal we have, and it is also the
 * cheapest to check.
 */
export function buildDiscoveryPlan(
  anchor: TalentIdentityAnchor,
  opts: DiscoveryPlanOptions = {}
): DiscoveryQuery[] {
  const resultsLimit = opts.resultsPerQuery ?? 100;
  const maxQueries = opts.maxQueries ?? 12;
  const slug = nameSlug(anchor.fullName);

  const watched: DiscoveryQuery[] = (opts.watchedHandles ?? [])
    .map((h) => h.replace(/^@/, "").trim().toLowerCase())
    .filter(Boolean)
    .map((value) => ({ mode: "account" as const, value, resultsLimit: Math.min(resultsLimit, 24) }));

  if (!slug) return watched.slice(0, maxQueries);

  // An open announcement window goes in ahead of the standing vocabulary.
  // During the fortnight after a cast reveal the character and production tags
  // are where the new content is — the actor's own name tag is dominated by
  // press and reaction, and the name+AI variants are tags that nobody has
  // started using for this role yet. The window's terms are capped and decay
  // (lib/monitor/vigilance.ts), so this is a temporary re-prioritisation of the
  // query budget rather than a permanent expansion of it.
  const vigilance: DiscoveryQuery[] = (anchor.vigilance?.extraHashtags ?? []).map((value) => ({
    mode: "hashtag" as const,
    value,
    resultsLimit,
  }));

  const discovery: DiscoveryQuery[] = [
    // The bare name tag, first and highest-volume.
    //
    // This was originally excluded as "99% fan content". Live checking proved
    // that backwards: #tomhardyai was completely empty, while a synthetic
    // Venom trailer sat under #tomhardy alongside the fan posts. Of course it
    // does — these accounts tag for reach, and the audience is under the
    // actor's name, not under a tag nobody searches. So the name tag is where
    // we look, and AI intent is decided downstream in the pre-filter rather
    // than baked into the query.
    { mode: "hashtag" as const, value: slug, resultsLimit },
    // AI-suffixed variants stay: cheap, occasionally productive, and high
    // precision when they do hit.
    ...AI_HASHTAG_SUFFIXES.slice(0, 2).map((suffix) => ({
      mode: "hashtag" as const,
      value: `${slug}${suffix}`,
      resultsLimit,
    })),
  ];

  // Title tags carry the same logic as the name tag — the observed post was
  // tagged #venom4, not #venom4ai — so sweep the bare title first.
  for (const title of anchor.knownForTitles.slice(0, 2)) {
    const titleSlug = nameSlug(title);
    if (titleSlug.length >= 4) {
      discovery.push({ mode: "hashtag", value: titleSlug, resultsLimit });
    }
  }

  // A window raises the ceiling as well as reordering under it: sweeping the
  // announcement vocabulary by dropping the name tag would be trading coverage
  // for coverage. The lift is bounded by what the window itself contributes.
  const effectiveMax = maxQueries + vigilance.length;
  const budget = Math.max(0, effectiveMax - watched.length);
  const planned = [...vigilance, ...discovery].filter(
    (q, i, all) => all.findIndex((o) => o.mode === q.mode && o.value === q.value) === i
  );
  return [...watched, ...planned.slice(0, budget)];
}

/**
 * The roster-level sweep. Run once per cycle for all monitored talent, then
 * name-matched per talent in the pre-filter.
 */
export function rosterHashtagQueries(resultsLimit = 200): DiscoveryQuery[] {
  return ROSTER_AI_HASHTAGS.map((value) => ({ mode: "hashtag" as const, value, resultsLimit }));
}
