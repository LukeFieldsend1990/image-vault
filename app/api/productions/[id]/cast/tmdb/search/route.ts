import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { eq, and } from "drizzle-orm";

interface TmdbTitleResult {
  id: number;
  title: string;
  mediaType: "movie" | "tv";
  year: number | null;
  posterPath: string | null;
}

// GET /api/productions/[id]/cast/tmdb/search?q=<title>
// Search TMDB for a movie or TV title to override the production's TMDB ID.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });

  const db = getDb();
  const production = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();

  if (!production) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(and(
          eq(organisationMembers.organisationId, production.organisationId),
          eq(organisationMembers.userId, session.sub)
        ))
        .get();
      if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const tmdbKey = process.env.TMDB_API_KEY;
  if (!tmdbKey) return NextResponse.json({ error: "Title search not configured" }, { status: 503 });

  const url = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(q)}&include_adult=false`;
  const res = await fetch(url);
  if (!res.ok) return NextResponse.json({ error: "Title search failed" }, { status: 502 });

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

  const results: TmdbTitleResult[] = (data.results ?? [])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 8)
    .map((r) => {
      const dateStr = r.release_date ?? r.first_air_date ?? "";
      const year = dateStr ? parseInt(dateStr.slice(0, 4)) : null;
      return {
        id: r.id,
        title: r.title ?? r.name ?? "Untitled",
        mediaType: r.media_type as "movie" | "tv",
        year: year && !isNaN(year) ? year : null,
        posterPath: r.poster_path ?? null,
      };
    });

  return NextResponse.json({ results });
}
