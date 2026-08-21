/**
 * Runtime-swappable Apify actors.
 *
 * The official apify/* Instagram actors bill around $2.30/1k results; the
 * store carries pay-per-result equivalents at a quarter of that, and which one
 * is best changes month to month. Compiling actor ids in meant every swap was
 * a deploy — this follows the follows-actor precedent (ingest/follows.ts):
 * defaults live in code, overrides live in ai_settings, and promotion happens
 * from /admin/monitor after a bake-off (scripts/discovery-bakeoff.mjs), not
 * from a commit.
 *
 * Settings rows are never seeded; an absent row means "use the default", and
 * clearing a row restores it.
 */

import { getDb } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { ACTORS } from "./apify";
import { TIKTOK_ACTOR } from "./tiktok";

type Db = ReturnType<typeof getDb>;

export const HASHTAG_ACTOR_KEY = "apify_hashtag_actor";
export const SEARCH_ACTOR_KEY = "apify_search_actor";
export const PROFILE_ACTOR_KEY = "apify_profile_actor";
export const TIKTOK_ACTOR_KEY = "apify_tiktok_actor";
export const RESULTS_PER_QUERY_KEY = "apify_results_per_query";

export const ACTOR_SETTING_KEYS = [
  HASHTAG_ACTOR_KEY,
  SEARCH_ACTOR_KEY,
  PROFILE_ACTOR_KEY,
  TIKTOK_ACTOR_KEY,
  RESULTS_PER_QUERY_KEY,
] as const;

export const ACTOR_DEFAULTS = {
  hashtag: ACTORS.hashtag,
  search: ACTORS.search,
  profile: ACTORS.profile,
  tiktok: TIKTOK_ACTOR,
} as const;

/** Apify REST actor ids use `owner~name`. */
export const ACTOR_ID_PATTERN = /^[a-z0-9._-]+~[a-z0-9._-]+$/i;

export interface ActorConfig {
  hashtag: string;
  search: string;
  profile: string;
  tiktok: string;
  /** Items per Instagram discovery query; undefined → the module default. */
  resultsPerQuery: number | undefined;
}

export function clampResultsPerQuery(raw: string | number | null | undefined): number | undefined {
  const n = typeof raw === "number" ? raw : parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(200, Math.max(10, Math.floor(n)));
}

/**
 * Effective actor config, one batched read. Resolved once per sweep in
 * discoverCandidates and threaded down — the ingest modules stay db-free.
 */
export async function resolveActorConfig(db: Db): Promise<ActorConfig> {
  const rows = await db
    .select({ key: aiSettings.key, value: aiSettings.value })
    .from(aiSettings)
    .where(inArray(aiSettings.key, [...ACTOR_SETTING_KEYS]))
    .all();
  const byKey = new Map(rows.map((r) => [r.key, r.value?.trim() ?? ""]));
  const actor = (key: string, fallback: string) => {
    const v = byKey.get(key);
    return v && ACTOR_ID_PATTERN.test(v) ? v : fallback;
  };
  return {
    hashtag: actor(HASHTAG_ACTOR_KEY, ACTOR_DEFAULTS.hashtag),
    search: actor(SEARCH_ACTOR_KEY, ACTOR_DEFAULTS.search),
    profile: actor(PROFILE_ACTOR_KEY, ACTOR_DEFAULTS.profile),
    tiktok: actor(TIKTOK_ACTOR_KEY, ACTOR_DEFAULTS.tiktok),
    resultsPerQuery: clampResultsPerQuery(byKey.get(RESULTS_PER_QUERY_KEY)),
  };
}
