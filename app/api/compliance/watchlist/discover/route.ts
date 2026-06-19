import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { canViewPlatformOversight } from "@/lib/compliance/grants";
import { activeWatchlistTmdbIds } from "@/lib/compliance/watchlist";
import { productions } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

// GET /api/compliance/watchlist/discover?q=<title>
// TMDB candidate search for promoting an upcoming production onto the watchlist.
// Each candidate is annotated with whether it is already ratified on Image Vault
// (a production shares its tmdbId) or already on the watchlist, so the maintainer
// only promotes genuinely-missing productions.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  if (!(await canViewPlatformOversight(db, session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ results: [] });

  const tmdbKey = process.env.TMDB_API_KEY;
  if (!tmdbKey) return NextResponse.json({ error: "TMDB not configured" }, { status: 503 });

  const res = await fetch(
    `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(q)}&include_adult=false`,
  );
  if (!res.ok) return NextResponse.json({ results: [] });

  const data = (await res.json()) as {
    results: Array<{
      id: number;
      media_type: string;
      title?: string;
      name?: string;
      release_date?: string;
      first_air_date?: string;
      poster_path?: string | null;
    }>;
  };

  const raw = (data.results ?? [])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 10);

  const tmdbIds = raw.map((r) => r.id);
  const ratifiedTmdbIds = new Set<number>();
  if (tmdbIds.length) {
    const existing = await db
      .select({ tmdbId: productions.tmdbId })
      .from(productions)
      .where(inArray(productions.tmdbId, tmdbIds))
      .all();
    for (const p of existing) if (p.tmdbId != null) ratifiedTmdbIds.add(p.tmdbId);
  }
  const onWatchlist = await activeWatchlistTmdbIds(db);

  const results = raw.map((r) => {
    const date = r.release_date || r.first_air_date || null;
    return {
      tmdbId: r.id,
      name: r.title || r.name || "Untitled",
      type: r.media_type === "tv" ? "tv_series" : "film",
      releaseDate: date,
      year: date ? Number(date.slice(0, 4)) || null : null,
      posterPath: r.poster_path ?? null,
      onImageVault: ratifiedTmdbIds.has(r.id),
      onWatchlist: onWatchlist.has(r.id),
    };
  });

  return NextResponse.json({ results });
}
