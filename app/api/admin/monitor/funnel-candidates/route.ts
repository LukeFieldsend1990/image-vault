import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hitSecondaryActors, likenessHits } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

/**
 * GET /api/admin/monitor/funnel-candidates
 *
 * The other side of the hit_secondary_actors table: every non-onboarded
 * actor we've identified in hits, ranked by how much AI content they show
 * up in. This is the outreach list — the pitch writes itself when you can
 * open the mail with "we've catalogued 40 AI-generated pieces featuring
 * you across the last three months, here are the top ten, sign up and we
 * file the takedowns".
 *
 * Aggregation is at the TMDB id level, not the raw string name, so
 * "John Cena" from ten different captions collapses to one row. Sample
 * hits are the three most recent, so the admin can eyeball what kind of
 * content the target is showing up in before reaching out.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

  // Aggregate first — cheap, group_by returns at most a few dozen rows even
  // once we're catching hundreds of actors. Then a second query pulls sample
  // hits for each of the top 30 for the outreach pitch.
  const candidates = await db
    .select({
      tmdbId: hitSecondaryActors.tmdbId,
      name: sql<string>`MAX(${hitSecondaryActors.tmdbName})`.as("name"),
      profileUrl: sql<string | null>`MAX(${hitSecondaryActors.tmdbProfileUrl})`.as("profile_url"),
      hitCount: sql<number>`COUNT(*)`.as("hit_count"),
      lastSeen: sql<number>`MAX(${hitSecondaryActors.detectedAt})`.as("last_seen"),
    })
    .from(hitSecondaryActors)
    .where(and(isNull(hitSecondaryActors.talentId), sql`${hitSecondaryActors.tmdbId} IS NOT NULL`))
    .groupBy(hitSecondaryActors.tmdbId)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(30)
    .all();

  // Sample hits per candidate — three most recent, so the pitch has real
  // links to point at. Runs one query per candidate rather than N joins
  // because the top-30 cap keeps this cheap and the per-row query is a
  // simple index lookup on hit_secondary_actors_tmdb_idx.
  const withSamples = await Promise.all(
    candidates.map(async (c) => {
      const samples = await db
        .select({
          hitId: hitSecondaryActors.hitId,
          contentUrl: likenessHits.contentUrl,
          authorHandle: likenessHits.authorHandle,
          detectedAt: hitSecondaryActors.detectedAt,
        })
        .from(hitSecondaryActors)
        .innerJoin(likenessHits, eq(likenessHits.id, hitSecondaryActors.hitId))
        .where(eq(hitSecondaryActors.tmdbId, c.tmdbId!))
        .orderBy(desc(hitSecondaryActors.detectedAt))
        .limit(3)
        .all();
      return {
        tmdbId: c.tmdbId,
        name: c.name,
        profileUrl: c.profileUrl,
        hitCount: c.hitCount,
        lastSeen: c.lastSeen,
        sampleHits: samples,
      };
    })
  );

  return NextResponse.json({ candidates: withSamples });
}
