export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { productions, organisationMembers, talentProfiles, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, and } from "drizzle-orm";

interface TmdbCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

interface TmdbCrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path: string | null;
}

interface TmdbCreditsResponse {
  cast: TmdbCastMember[];
  crew: TmdbCrewMember[];
}

// GET /api/productions/[id]/cast/tmdb
// Fetch TMDB credits for the production and match against existing talent profiles.
// Auth: licensee org member or admin.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const production = await db
    .select({
      id: productions.id,
      name: productions.name,
      tmdbId: productions.tmdbId,
      type: productions.type,
      organisationId: productions.organisationId,
    })
    .from(productions)
    .where(eq(productions.id, id))
    .get();

  if (!production) {
    return NextResponse.json({ error: "Production not found" }, { status: 404 });
  }

  if (!production.tmdbId) {
    return NextResponse.json({ error: "Production has no TMDB ID" }, { status: 422 });
  }

  // Auth check
  if (!isAdmin(session.email)) {
    if (session.role !== "licensee") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, production.organisationId),
            eq(organisationMembers.userId, session.sub)
          )
        )
        .get();
      if (!membership) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  // Resolve TMDB API key
  let tmdbKey: string | undefined;
  try {
    tmdbKey = getRequestContext().env.TMDB_API_KEY;
  } catch {
    // getRequestContext not available in local dev
  }
  tmdbKey = tmdbKey ?? process.env.TMDB_API_KEY;

  if (!tmdbKey) {
    return NextResponse.json({ error: "TMDB API key not configured" }, { status: 503 });
  }

  // Determine endpoint: movie or tv
  const isTv = production.type === "tv_series";
  const mediaType = isTv ? "tv" : "movie";
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${production.tmdbId}/credits?api_key=${tmdbKey}`;

  let tmdbData: TmdbCreditsResponse;
  try {
    const res = await fetch(tmdbUrl);
    if (!res.ok) {
      return NextResponse.json({ error: "TMDB API request failed" }, { status: 502 });
    }
    tmdbData = (await res.json()) as TmdbCreditsResponse;
  } catch {
    return NextResponse.json({ error: "Failed to fetch TMDB credits" }, { status: 502 });
  }

  const castList = tmdbData.cast ?? [];

  if (castList.length === 0) {
    return NextResponse.json({ cast: [] });
  }

  // Load all talent profiles to match
  const allProfiles = await db
    .select({
      userId: talentProfiles.userId,
      fullName: talentProfiles.fullName,
      tmdbId: talentProfiles.tmdbId,
    })
    .from(talentProfiles)
    .all();

  // Build lookup maps
  const byTmdbId = new Map<number, typeof allProfiles[0]>();
  const byName = new Map<string, typeof allProfiles[0]>();
  for (const p of allProfiles) {
    if (p.tmdbId !== null && p.tmdbId !== undefined) {
      byTmdbId.set(p.tmdbId, p);
    }
    byName.set(p.fullName.toLowerCase(), p);
  }

  // For matched profiles, look up their email
  const matchedUserIds = new Set<string>();
  for (const castMember of castList) {
    const byId = byTmdbId.get(castMember.id);
    const byN = byName.get(castMember.name.toLowerCase());
    const match = byId ?? byN;
    if (match) matchedUserIds.add(match.userId);
  }

  const userEmailMap = new Map<string, string>();
  if (matchedUserIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .all();
    for (const u of userRows) {
      if (matchedUserIds.has(u.id)) {
        userEmailMap.set(u.id, u.email);
      }
    }
  }

  const result = castList.map((castMember) => {
    const byId = byTmdbId.get(castMember.id);
    const byN = byName.get(castMember.name.toLowerCase());
    const match = byId ?? byN;
    return {
      tmdbId: castMember.id,
      name: castMember.name,
      character: castMember.character,
      department: "Acting",
      profilePath: castMember.profile_path ?? undefined,
      matched: match !== undefined,
      talentId: match?.userId ?? undefined,
      talentEmail: match ? (userEmailMap.get(match.userId) ?? undefined) : undefined,
    };
  });

  return NextResponse.json({ cast: result });
}
