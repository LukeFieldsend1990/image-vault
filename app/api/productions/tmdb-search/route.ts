export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";

// GET /api/productions/tmdb-search?q=<title>
// Lightweight TMDB multi-search (movie + TV only) for the New Production form.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ results: [] });

  const tmdbKey = process.env.TMDB_API_KEY;
  if (!tmdbKey) return NextResponse.json({ error: "TMDB not configured" }, { status: 503 });

  const res = await fetch(
    `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(q)}&include_adult=false`
  );
  if (!res.ok) return NextResponse.json({ results: [] });

  const data = await res.json() as {
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

  const results = (data.results ?? [])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 8);

  return NextResponse.json({ results });
}
