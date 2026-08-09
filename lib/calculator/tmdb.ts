/**
 * TMDB lookups for the public /calculator applet.
 *
 * Deliberately separate from lib/productions/tmdb-cast.ts: that path matches
 * cast against talent accounts in D1. This one is anonymous — it takes a name,
 * returns credits, and touches no database. Nothing a visitor searches for is
 * written down.
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const PROFILE_BASE = "https://image.tmdb.org/t/p/w185";
const POSTER_BASE = "https://image.tmdb.org/t/p/w92";

/** Most credits any one person can bring into the grid. */
export const MAX_CREDITS = 60;

export interface CalculatorPerson {
  id: number;
  name: string;
  profileImageUrl: string | null;
  knownFor: string[];
}

export interface CalculatorCredit {
  /** Stable key across media types — TMDB numbers films and TV separately. */
  id: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  character: string | null;
  releaseDate: string | null;
  year: number | null;
  posterUrl: string | null;
  /** TV only — how many episodes the credit covers. */
  episodeCount: number | null;
}

interface TmdbPersonResult {
  id: number;
  name: string;
  profile_path: string | null;
  popularity: number;
  known_for_department?: string;
  known_for?: Array<{ media_type: string; title?: string; name?: string }>;
}

interface TmdbCombinedCredit {
  id: number;
  media_type: string;
  title?: string;
  name?: string;
  character?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  episode_count?: number;
  popularity?: number;
}

export type TmdbResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

function apiKey(): string | null {
  return process.env.TMDB_API_KEY ?? null;
}

async function tmdbFetch<T>(path: string, params: Record<string, string>): Promise<TmdbResult<T>> {
  const key = apiKey();
  if (!key) return { ok: false, status: 503, error: "Credit lookup isn't configured right now." };

  const url = new URL(`${TMDB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", key);

  try {
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (res.status === 404) return { ok: false, status: 404, error: "We couldn't find that name." };
    if (!res.ok) return { ok: false, status: 502, error: "Credit lookup failed. Try again in a moment." };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 502, error: "Credit lookup failed. Try again in a moment." };
  }
}

/** Search people by acting name. Actors first, then by TMDB popularity. */
export async function searchPeople(query: string, limit = 8): Promise<TmdbResult<CalculatorPerson[]>> {
  const res = await tmdbFetch<{ results?: TmdbPersonResult[] }>("/search/person", {
    query,
    page: "1",
    include_adult: "false",
  });
  if (!res.ok) return res;

  const people = (res.data.results ?? [])
    .sort((a, b) => {
      const actorA = a.known_for_department === "Acting" ? 1 : 0;
      const actorB = b.known_for_department === "Acting" ? 1 : 0;
      if (actorA !== actorB) return actorB - actorA;
      return (b.popularity ?? 0) - (a.popularity ?? 0);
    })
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      name: p.name,
      profileImageUrl: p.profile_path ? `${PROFILE_BASE}${p.profile_path}` : null,
      knownFor: (p.known_for ?? [])
        .map((k) => k.title ?? k.name ?? "")
        .filter((t) => t.length > 0)
        .slice(0, 3),
    }));

  return { ok: true, data: people };
}

/**
 * A person's acting credits over the last `lookbackYears` calendar years,
 * newest first.
 *
 * Combined credits are noisy for working actors — chat-show sofas, awards
 * ceremonies and "archive footage" all arrive as cast entries. Those are
 * dropped: none of them commission a scan, and leaving them in makes the grid
 * feel wrong to the one audience that would notice.
 */
export async function fetchRecentActingCredits(
  personId: number,
  lookbackYears: number,
  now: Date = new Date(),
): Promise<TmdbResult<{ person: CalculatorPerson; credits: CalculatorCredit[] }>> {
  const res = await tmdbFetch<{
    id: number;
    name: string;
    profile_path: string | null;
    cast?: TmdbCombinedCredit[];
  }>(`/person/${personId}/combined_credits`, {});
  if (!res.ok) return res;

  const detail = await tmdbFetch<{ id: number; name: string; profile_path: string | null }>(
    `/person/${personId}`,
    {},
  );
  if (!detail.ok) return detail;

  const cutoffYear = now.getUTCFullYear() - lookbackYears + 1;
  const seen = new Set<string>();

  const credits = (res.data.cast ?? [])
    .filter((c) => c.media_type === "movie" || c.media_type === "tv")
    .map((c): CalculatorCredit => {
      const mediaType = c.media_type === "tv" ? "tv" : "movie";
      const releaseDate = (c.media_type === "tv" ? c.first_air_date : c.release_date) || null;
      const yearStr = releaseDate?.slice(0, 4);
      const year = yearStr && /^\d{4}$/.test(yearStr) ? Number(yearStr) : null;
      return {
        id: `${mediaType}-${c.id}`,
        tmdbId: c.id,
        mediaType,
        title: (c.media_type === "tv" ? c.name : c.title) ?? "Untitled",
        character: c.character?.trim() || null,
        releaseDate,
        year,
        posterUrl: c.poster_path ? `${POSTER_BASE}${c.poster_path}` : null,
        episodeCount: typeof c.episode_count === "number" ? c.episode_count : null,
      };
    })
    .filter((c) => c.year !== null && c.year >= cutoffYear)
    .filter((c) => !isNonProductionAppearance(c))
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    })
    .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""))
    .slice(0, MAX_CREDITS);

  return {
    ok: true,
    data: {
      person: {
        id: detail.data.id,
        name: detail.data.name,
        profileImageUrl: detail.data.profile_path ? `${PROFILE_BASE}${detail.data.profile_path}` : null,
        knownFor: [],
      },
      credits,
    },
  };
}

/** Chat shows, awards nights, archive footage — appearances, not engagements. */
function isNonProductionAppearance(credit: CalculatorCredit): boolean {
  const character = credit.character?.toLowerCase() ?? "";
  if (/^(self|himself|herself|themselves)\b/.test(character)) return true;
  if (character.includes("archive footage") || character.includes("uncredited")) return true;

  const title = credit.title.toLowerCase();
  if (/\b(awards?|red carpet|tonight show|late show|late night|talk|interview)\b/.test(title)) return true;

  return false;
}
