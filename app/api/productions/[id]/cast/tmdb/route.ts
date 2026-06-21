import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { fetchTmdbCastWithMatches } from "@/lib/productions/tmdb-cast";
import { eq, and } from "drizzle-orm";

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

  // Auth check
  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) {
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

  const overrideParam = new URL(req.url).searchParams.get("overrideTmdbId");
  const overrideTmdbId = overrideParam ? parseInt(overrideParam) : undefined;

  const result = await fetchTmdbCastWithMatches(db, production, overrideTmdbId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ cast: result.cast });
}
