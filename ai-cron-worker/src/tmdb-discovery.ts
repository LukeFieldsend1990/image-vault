/**
 * Nightly TMDB pre-production discovery.
 *
 * Fetches the most popular upcoming movies from TMDB that aren't yet on Image
 * Vault (neither as a ratified production nor as a watchlist entry), then
 * inserts up to DAILY_LIMIT rows into `production_watchlist` so union members
 * can review them and flag any for outreach.
 *
 * The `added_by` value is the sentinel "cron" — FK enforcement is off by
 * default in SQLite/D1, and the watchlist UI already handles null addedByName
 * gracefully (shows "TMDB" without the "· added by …" suffix).
 */

import { drizzle } from "drizzle-orm/d1";
import { inArray } from "drizzle-orm";
import { productions, productionWatchlist } from "./schema";

type Db = ReturnType<typeof drizzle>;

interface TmdbMovie {
  id: number;
  title: string;
  release_date?: string;
}

const DAILY_LIMIT = 10;

export async function runTmdbDiscovery(
  tmdbKey: string,
  db: Db,
): Promise<{ added: number; alreadyKnown: number; deferred: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const twoYearsOut = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const url =
    `https://api.themoviedb.org/3/discover/movie` +
    `?api_key=${tmdbKey}` +
    `&sort_by=popularity.desc` +
    `&primary_release_date.gte=${today}` +
    `&primary_release_date.lte=${twoYearsOut}` +
    `&include_adult=false` +
    `&with_original_language=en` +
    `&page=1`;

  const res = await fetch(url);
  if (!res.ok) {
    console.log(`TMDB discovery failed: HTTP ${res.status}`);
    return { added: 0, alreadyKnown: 0, deferred: 0 };
  }

  const data = (await res.json()) as { results?: TmdbMovie[] };
  const candidates = data.results ?? [];
  if (candidates.length === 0) return { added: 0, alreadyKnown: 0, deferred: 0 };

  const tmdbIds = candidates.map((c) => c.id);

  const [ratifiedRows, watchlistRows] = await Promise.all([
    db.select({ tmdbId: productions.tmdbId }).from(productions).where(inArray(productions.tmdbId, tmdbIds)).all(),
    db.select({ tmdbId: productionWatchlist.tmdbId }).from(productionWatchlist).where(inArray(productionWatchlist.tmdbId, tmdbIds)).all(),
  ]);

  const known = new Set<number>([
    ...ratifiedRows.map((r) => r.tmdbId).filter((id): id is number => id != null),
    ...watchlistRows.map((r) => r.tmdbId).filter((id): id is number => id != null),
  ]);

  const fresh = candidates.filter((c) => !known.has(c.id));
  const toInsert = fresh.slice(0, DAILY_LIMIT);

  const now = Math.floor(Date.now() / 1000);
  for (const movie of toInsert) {
    const releaseTs = movie.release_date
      ? Math.floor(new Date(movie.release_date).getTime() / 1000)
      : null;
    await db.insert(productionWatchlist).values({
      id: crypto.randomUUID(),
      name: movie.title,
      companyName: null,
      tmdbId: movie.id,
      type: "film",
      expectedStage: "pre_production",
      expectedStartDate: releaseTs,
      source: "tmdb",
      notes: null,
      flaggedForOutreach: false,
      outreachNotes: null,
      addedBy: "cron",
      addedAt: now,
      updatedAt: now,
    });
  }

  const deferred = fresh.length - toInsert.length;
  console.log(
    `TMDB discovery: ${toInsert.length} added, ${known.size} already known, ${deferred} deferred`,
  );
  return { added: toInsert.length, alreadyKnown: known.size, deferred };
}
