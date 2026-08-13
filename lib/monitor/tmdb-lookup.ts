/**
 * Minimal TMDB person lookup for secondary-actor rows.
 *
 * The scan pipeline surfaces additional actors by name (from captions or
 * hashtags) or by TMDB id (later, from face-embedding matches against a
 * cached embedding library). Either way we need a real profile_path so the
 * UI can render a headshot rather than an initials fallback. Kept separate
 * from lib/calculator/tmdb.ts because that one is optimised for search;
 * this one is optimised for the single-id case and returns a cached-ready
 * absolute URL.
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const PROFILE_BASE = "https://image.tmdb.org/t/p/w500";

export interface TmdbPerson {
  tmdbId: number;
  name: string;
  profileUrl: string | null;
}

export async function fetchTmdbPersonById(
  tmdbId: number,
  apiKey: string
): Promise<TmdbPerson | null> {
  const url = new URL(`${TMDB_BASE}/person/${tmdbId}`);
  url.searchParams.set("api_key", apiKey);

  try {
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: number; name?: string; profile_path?: string | null };
    if (!data.id || !data.name) return null;
    return {
      tmdbId: data.id,
      name: data.name,
      profileUrl: data.profile_path ? `${PROFILE_BASE}${data.profile_path}` : null,
    };
  } catch {
    return null;
  }
}
