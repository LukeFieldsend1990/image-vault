import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { likenessHits, users, talentProfiles, monitorAccounts, takedownSubmissions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { desc, eq, inArray } from "drizzle-orm";

const OPEN_STATUSES = ["takedown_requested"] as const;
const CLOSED_STATUSES = ["resolved", "dismissed"] as const;

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

// GET /api/admin/monitor/takedowns — every hit the talent has asked us to take
// down, plus closed cases so a first cut of throughput is visible. This is the
// backlog list that will eventually feed the Meta contact automation.
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const filter = req.nextUrl.searchParams.get("status") ?? "open";
  const statuses =
    filter === "closed" ? CLOSED_STATUSES : filter === "all" ? [...OPEN_STATUSES, ...CLOSED_STATUSES] : OPEN_STATUSES;

  const db = getDb();

  const rows = await db
    .select({
      hit: likenessHits,
      talent: {
        id: users.id,
        email: users.email,
        fullName: talentProfiles.fullName,
        authOnFile: talentProfiles.enforcementAuthorizationOnFile,
      },
      account: {
        id: monitorAccounts.id,
        handle: monitorAccounts.handle,
        displayName: monitorAccounts.displayName,
        followerCount: monitorAccounts.followerCount,
        status: monitorAccounts.status,
      },
    })
    .from(likenessHits)
    .innerJoin(users, eq(users.id, likenessHits.talentId))
    .leftJoin(talentProfiles, eq(talentProfiles.userId, users.id))
    .leftJoin(monitorAccounts, eq(monitorAccounts.id, likenessHits.accountId))
    .where(inArray(likenessHits.status, [...statuses]))
    .orderBy(desc(likenessHits.statusUpdatedAt))
    .limit(200)
    .all();

  // Attach the latest submission per hit (if any) so the admin UI can show
  // "sent 2h ago to ip@instagram.com" without a second round-trip.
  const hitIds = rows.map((r) => r.hit.id);
  const submissions =
    hitIds.length > 0
      ? await db
          .select({
            hitId: takedownSubmissions.hitId,
            id: takedownSubmissions.id,
            recipient: takedownSubmissions.recipient,
            method: takedownSubmissions.method,
            sentAt: takedownSubmissions.sentAt,
            platformStatus: takedownSubmissions.platformStatus,
            platformReference: takedownSubmissions.platformReference,
          })
          .from(takedownSubmissions)
          .where(inArray(takedownSubmissions.hitId, hitIds))
          .orderBy(desc(takedownSubmissions.sentAt))
          .all()
      : [];
  const latestByHit = new Map<string, (typeof submissions)[number]>();
  for (const s of submissions) {
    if (!latestByHit.has(s.hitId)) latestByHit.set(s.hitId, s);
  }

  const takedowns = rows.map((r) => {
    const sub = latestByHit.get(r.hit.id) ?? null;
    return {
      id: r.hit.id,
      talentId: r.talent.id,
      talentName: r.talent.fullName ?? r.talent.email,
      talentEmail: r.talent.email,
      authorizationOnFile: r.talent.authOnFile === true,
      platform: r.hit.platform,
      contentUrl: r.hit.contentUrl,
      authorHandle: r.hit.authorHandle,
      caption: r.hit.caption,
      riskLevel: r.hit.riskLevel,
      confidence: r.hit.confidence,
      aiGeneratedLikelihood: r.hit.aiGeneratedLikelihood,
      status: r.hit.status,
      requestedAt: r.hit.statusUpdatedAt,
      detectedAt: r.hit.detectedAt,
      account: r.account?.id
        ? {
            handle: r.account.handle,
            displayName: r.account.displayName,
            followerCount: r.account.followerCount,
            status: r.account.status,
          }
        : null,
      submission: sub
        ? {
            id: sub.id,
            recipient: sub.recipient,
            method: sub.method,
            sentAt: sub.sentAt,
            platformStatus: sub.platformStatus,
            platformReference: sub.platformReference,
          }
        : null,
    };
  });

  return NextResponse.json({ takedowns });
}

// PATCH /api/admin/monitor/takedowns — mark a takedown as resolved (successfully
// removed from the platform) or dismissed (we're not pursuing). Body: { hitId, status }.
export async function PATCH(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const body = (await req.json().catch(() => ({}))) as { hitId?: string; status?: string };
  if (!body.hitId || !body.status) {
    return NextResponse.json({ error: "hitId and status required" }, { status: 400 });
  }
  if (body.status !== "resolved" && body.status !== "dismissed") {
    return NextResponse.json({ error: "status must be resolved or dismissed" }, { status: 400 });
  }

  const db = getDb();
  const hit = await db
    .select({ id: likenessHits.id })
    .from(likenessHits)
    .where(eq(likenessHits.id, body.hitId))
    .get();
  if (!hit) return NextResponse.json({ error: "Hit not found" }, { status: 404 });

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(likenessHits)
    .set({
      status: body.status,
      statusUpdatedBy: g.session.sub,
      statusUpdatedAt: now,
    })
    .where(eq(likenessHits.id, body.hitId));

  return NextResponse.json({ ok: true, status: body.status });
}
