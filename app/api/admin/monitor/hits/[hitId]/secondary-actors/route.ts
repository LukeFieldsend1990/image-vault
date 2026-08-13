import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hitSecondaryActors, likenessHits, users, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { and, eq } from "drizzle-orm";

/**
 * Admin endpoint for stacking additional actors against a hit ahead of the
 * automated detection landing with Phase 2. Two shapes accepted per row:
 *
 *   { talentId: "<uuid>" }         → resolve against an onboarded talent
 *   { tmdbId, tmdbName, tmdbProfileUrl } → non-onboarded, cached from TMDB
 *
 * Once Workers-AI face embeddings land, the detection code writes these same
 * rows under source="face_embedding" or "vision_caption". This endpoint keeps
 * source="manual" so we can tell seeded rows apart from real detections.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hitId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { hitId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    actors?: Array<{
      talentId?: string;
      tmdbId?: number;
      tmdbName?: string;
      tmdbProfileUrl?: string;
      confidence?: number;
    }>;
  };

  if (!Array.isArray(body.actors) || !body.actors.length) {
    return NextResponse.json({ error: "actors[] required" }, { status: 400 });
  }

  const db = getDb();
  const hit = await db.select({ id: likenessHits.id }).from(likenessHits).where(eq(likenessHits.id, hitId)).get();
  if (!hit) return NextResponse.json({ error: "Hit not found" }, { status: 404 });

  const now = Math.floor(Date.now() / 1000);
  const inserted: string[] = [];

  for (const raw of body.actors) {
    // For onboarded actors, pull the display name / headshot straight from
    // talent_profiles so the UI reads the same row regardless of route.
    // Cached tmdb_* columns fill in for non-onboarded actors.
    let talentId: string | null = null;
    let tmdbId: number | null = raw.tmdbId ?? null;
    let tmdbName: string | null = raw.tmdbName ?? null;
    let tmdbProfileUrl: string | null = raw.tmdbProfileUrl ?? null;

    if (raw.talentId) {
      const talent = await db
        .select({
          id: users.id,
          tmdbId: talentProfiles.tmdbId,
          fullName: talentProfiles.fullName,
          profileImageUrl: talentProfiles.profileImageUrl,
        })
        .from(users)
        .leftJoin(talentProfiles, eq(talentProfiles.userId, users.id))
        .where(and(eq(users.id, raw.talentId), eq(users.role, "talent")))
        .get();
      if (!talent) {
        return NextResponse.json({ error: `Talent ${raw.talentId} not found` }, { status: 404 });
      }
      talentId = talent.id;
      tmdbId = talent.tmdbId ?? tmdbId;
      tmdbName = talent.fullName ?? tmdbName;
      tmdbProfileUrl = talent.profileImageUrl ?? tmdbProfileUrl;
    }

    if (!talentId && !tmdbId) {
      return NextResponse.json(
        { error: "Each actor must have talentId or tmdbId" },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    await db.insert(hitSecondaryActors).values({
      id,
      hitId,
      talentId,
      tmdbId,
      tmdbName,
      tmdbProfileUrl,
      confidence: Math.max(0, Math.min(100, Math.round(raw.confidence ?? 100))),
      source: "manual",
      detectedAt: now,
    });
    inserted.push(id);
  }

  return NextResponse.json({ ok: true, inserted });
}

// DELETE — remove one secondary actor from a hit. Body: { id }.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ hitId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { hitId } = await params;
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = getDb();
  await db
    .delete(hitSecondaryActors)
    .where(and(eq(hitSecondaryActors.id, body.id), eq(hitSecondaryActors.hitId, hitId)));

  return NextResponse.json({ ok: true });
}
