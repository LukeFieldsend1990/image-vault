export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w185";

export interface TmdbCandidate {
  id: number;
  name: string;
  profileImageUrl: string | null;
  knownFor: Array<{ title: string; year: string; type: "movie" | "tv" }>;
  popularity: number;
}

interface TmdbRawResult {
  id: number;
  name: string;
  profile_path: string | null;
  popularity: number;
  known_for: Array<{
    media_type: "movie" | "tv";
    title?: string;
    name?: string;
    release_date?: string;
    first_air_date?: string;
  }>;
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  // Only talent goes through onboarding
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts use onboarding" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "TMDB not configured" }, { status: 503 });
  }

  const url = new URL(`${TMDB_BASE}/search/person`);
  url.searchParams.set("query", q);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("page", "1");
  url.searchParams.set("include_adult", "false");

  const tmdbRes = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!tmdbRes.ok) {
    return NextResponse.json({ error: "TMDB search failed" }, { status: 502 });
  }

  const tmdbData = await tmdbRes.json() as { results?: TmdbRawResult[] };
  const raw = tmdbData.results ?? [];

  // Normalise to TmdbCandidate — filter to actors only, top 8
  const candidates: TmdbCandidate[] = raw
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      name: p.name,
      profileImageUrl: p.profile_path ? `${IMG_BASE}${p.profile_path}` : null,
      popularity: Math.round(p.popularity * 10) / 10,
      knownFor: (p.known_for ?? []).slice(0, 3).map((k) => ({
        title: k.media_type === "movie" ? (k.title ?? "") : (k.name ?? ""),
        year: (k.release_date ?? k.first_air_date ?? "").slice(0, 4),
        type: k.media_type,
      })),
    }));

  return NextResponse.json({ candidates });
}
