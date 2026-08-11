/**
 * Profile lookup and watchlist enrichment.
 *
 * Two jobs, both learned the hard way.
 *
 * **Verification.** A handle that does not exist sits on the watchlist looking
 * exactly like one that does — swept every cycle, returning nothing, costing a
 * query each time and quietly implying coverage we do not have. This happened
 * during development: `reveal.aii` was read off branding burnt into a video and
 * added to the seed list, while the actual account was `leakingai`. A silent
 * dud is worse than a rejected entry, so handles get checked against the
 * platform rather than trusted.
 *
 * **Enrichment.** Hashtag and search sweeps return no profile-level fields, so
 * `followerCount` on a discovered account is always null. The profile actor
 * fills it in one batched run for many handles, which is what lets the
 * case-file UI show audience size next to reach.
 */

import { getDb } from "@/lib/db";
import { monitorAccounts } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { ApifyError, runActor } from "./apify";
import { normaliseHandle } from "./follows";

type Db = ReturnType<typeof getDb>;

export const PROFILE_ACTOR = "apify~instagram-profile-scraper";

export interface ProfileRecord {
  handle: string;
  exists: boolean;
  displayName: string | null;
  followerCount: number | null;
  postsCount: number | null;
  verified: boolean;
  biography: string | null;
}

interface ProfileItem {
  username?: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  postsCount?: number;
  verified?: boolean;
  isVerified?: boolean;
  error?: string;
}

export interface ProfileLookupResult {
  profiles: ProfileRecord[];
  runId: string | null;
  costUsd: number | null;
  error: string | null;
}

/**
 * Look up many handles in one run. Batched deliberately — the actor accepts an
 * array, and one run for fifty handles is both cheaper and far kinder to the
 * spend ceiling than fifty runs.
 */
export async function fetchProfiles(opts: {
  token: string;
  handles: string[];
  signal?: AbortSignal;
}): Promise<ProfileLookupResult> {
  const handles = [...new Set(opts.handles.map((h) => normaliseHandle(h)).filter((h): h is string => !!h))];
  if (!handles.length) {
    return { profiles: [], runId: null, costUsd: null, error: "No valid handles to check." };
  }

  try {
    const run = await runActor<ProfileItem>({
      token: opts.token,
      actorId: PROFILE_ACTOR,
      input: { usernames: handles },
      maxItems: handles.length,
      signal: opts.signal,
    });

    const byHandle = new Map<string, ProfileRecord>();
    for (const item of run.items) {
      const handle = normaliseHandle(item.username ?? "");
      if (!handle) continue;
      byHandle.set(handle, {
        handle,
        // The actor reports a missing account as an error row rather than
        // omitting it, which is what makes verification possible at all.
        exists: !item.error,
        displayName: item.fullName ?? null,
        followerCount: typeof item.followersCount === "number" ? item.followersCount : null,
        postsCount: typeof item.postsCount === "number" ? item.postsCount : null,
        verified: item.verified === true || item.isVerified === true,
        biography: item.biography ?? null,
      });
    }

    // A handle the actor never mentioned is unresolved, not confirmed-missing.
    // Treated as existing so a flaky run cannot mass-delete a good watchlist.
    const profiles = handles.map(
      (handle) =>
        byHandle.get(handle) ?? {
          handle,
          exists: true,
          displayName: null,
          followerCount: null,
          postsCount: null,
          verified: false,
          biography: null,
        }
    );

    return { profiles, runId: run.runId, costUsd: run.costUsd, error: null };
  } catch (err) {
    const reason = err instanceof ApifyError ? err.reason : "unknown";
    return {
      profiles: [],
      runId: err instanceof ApifyError ? err.runId : null,
      costUsd: err instanceof ApifyError ? err.costUsd : null,
      error: `Profile lookup failed (${reason}).`,
    };
  }
}

export interface EnrichmentSummary {
  checked: number;
  enriched: number;
  missing: string[];
}

/**
 * Write profile facts back onto the watchlist.
 *
 * Non-existent handles are *reported*, never auto-deleted — the admin decides.
 * An actor hiccup should not silently empty a curated list.
 */
export async function enrichWatchlist(
  db: Db,
  platform: string,
  profiles: ProfileRecord[]
): Promise<EnrichmentSummary> {
  const missing: string[] = [];
  let enriched = 0;

  for (const profile of profiles) {
    if (!profile.exists) {
      missing.push(profile.handle);
      continue;
    }
    if (profile.followerCount == null && !profile.displayName) continue;

    await db
      .update(monitorAccounts)
      .set({
        followerCount: profile.followerCount,
        displayName: profile.displayName,
      })
      .where(and(eq(monitorAccounts.platform, platform), eq(monitorAccounts.handle, profile.handle)));
    enriched++;
  }

  return { checked: profiles.length, enriched, missing };
}

/** Watchlist handles for a platform, oldest-checked first. */
export async function watchlistHandles(db: Db, platform: string, limit = 100): Promise<string[]> {
  const rows = await db
    .select({ handle: monitorAccounts.handle })
    .from(monitorAccounts)
    .where(and(eq(monitorAccounts.platform, platform), eq(monitorAccounts.status, "watchlist")))
    .limit(limit)
    .all();
  return rows.map((r) => r.handle);
}

/** Remove confirmed-missing handles that have never produced a hit. */
export async function pruneMissing(db: Db, platform: string, handles: string[]): Promise<number> {
  if (!handles.length) return 0;
  const rows = await db
    .select({ id: monitorAccounts.id, hitCount: monitorAccounts.hitCount })
    .from(monitorAccounts)
    .where(and(eq(monitorAccounts.platform, platform), inArray(monitorAccounts.handle, handles)))
    .all();

  // An account with hits is evidence even if the handle has since vanished —
  // deleting it would orphan those records.
  const removable = rows.filter((r) => r.hitCount === 0).map((r) => r.id);
  if (!removable.length) return 0;

  await db.delete(monitorAccounts).where(inArray(monitorAccounts.id, removable));
  return removable.length;
}
