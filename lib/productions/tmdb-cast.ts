/**
 * Shared TMDB cast fetch + talent-matching.
 *
 * Used by GET /api/productions/[id]/cast/tmdb (display) and
 * POST /api/productions/[id]/cast/tmdb/import (bulk placeholder import) so the
 * two paths fetch and match identically.
 */

import { talentProfiles, users } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface MatchedCastMember {
  tmdbId: number;
  name: string;
  character: string;
  department: string;        // always "Acting"
  profilePath?: string;
  matched: boolean;          // true if a talent account already exists on Image Vault
  talentId?: string;
  talentEmail?: string;
}

interface TmdbCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

interface TmdbCreditsResponse {
  cast: TmdbCastMember[];
}

export type TmdbCastResult =
  | { ok: true; cast: MatchedCastMember[] }
  | { ok: false; status: number; error: string };

/**
 * Fetch a production's TMDB billed cast and tag each member with whether a
 * matching talent account already exists (by tmdbId, falling back to name).
 */
export async function fetchTmdbCastWithMatches(
  db: Db,
  production: { type: string | null; tmdbId: number | null },
  overrideTmdbId?: number | null,
): Promise<TmdbCastResult> {
  const tmdbId = overrideTmdbId ?? production.tmdbId;
  if (!tmdbId) return { ok: false, status: 422, error: "Production has no TMDB ID" };

  const tmdbKey = process.env.TMDB_API_KEY;
  if (!tmdbKey) return { ok: false, status: 503, error: "TMDB API key not configured" };

  const mediaType = production.type === "tv_series" ? "tv" : "movie";
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/credits?api_key=${tmdbKey}`;

  let tmdbData: TmdbCreditsResponse;
  try {
    const res = await fetch(tmdbUrl);
    if (!res.ok) return { ok: false, status: 502, error: "TMDB API request failed" };
    tmdbData = (await res.json()) as TmdbCreditsResponse;
  } catch {
    return { ok: false, status: 502, error: "Failed to fetch TMDB credits" };
  }

  const castList = tmdbData.cast ?? [];
  if (castList.length === 0) return { ok: true, cast: [] };

  // Load talent profiles and build lookup maps (by tmdbId, then normalized name).
  const allProfiles = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName, tmdbId: talentProfiles.tmdbId })
    .from(talentProfiles)
    .all();

  const byTmdbId = new Map<number, typeof allProfiles[0]>();
  const byName = new Map<string, typeof allProfiles[0]>();
  for (const p of allProfiles) {
    if (p.tmdbId !== null && p.tmdbId !== undefined) byTmdbId.set(p.tmdbId, p);
    byName.set(p.fullName.toLowerCase(), p);
  }

  const matchedUserIds = new Set<string>();
  for (const c of castList) {
    const match = byTmdbId.get(c.id) ?? byName.get(c.name.toLowerCase());
    if (match) matchedUserIds.add(match.userId);
  }

  const userEmailMap = new Map<string, string>();
  if (matchedUserIds.size > 0) {
    const userRows = await db.select({ id: users.id, email: users.email }).from(users).all();
    for (const u of userRows) {
      if (matchedUserIds.has(u.id)) userEmailMap.set(u.id, u.email);
    }
  }

  const cast: MatchedCastMember[] = castList.map((c) => {
    const match = byTmdbId.get(c.id) ?? byName.get(c.name.toLowerCase());
    return {
      tmdbId: c.id,
      name: c.name,
      character: c.character,
      department: "Acting",
      profilePath: c.profile_path ?? undefined,
      matched: match !== undefined,
      talentId: match?.userId ?? undefined,
      talentEmail: match ? (userEmailMap.get(match.userId) ?? undefined) : undefined,
    };
  });

  return { ok: true, cast };
}
