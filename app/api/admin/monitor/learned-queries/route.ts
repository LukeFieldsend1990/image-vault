import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { monitorLearnedQueries, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { desc, eq } from "drizzle-orm";

// Hashtags mined from confirmed hits (lib/monitor/query-mining.ts) and fed back
// into the next sweep's query set. They drive real spend and real coverage, so
// they need to be visible somewhere rather than only in D1 and the sweep logs.
//
// GET  — every learned query, highest-yield first, with the talent it belongs to.
// POST — { id, active } to retire a query that is pulling noise (or revive it).

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const db = getDb();

  const rows = await db
    .select({
      id: monitorLearnedQueries.id,
      talentId: monitorLearnedQueries.talentId,
      talentName: talentProfiles.fullName,
      platform: monitorLearnedQueries.platform,
      query: monitorLearnedQueries.query,
      hitCount: monitorLearnedQueries.hitCount,
      firstSeenAt: monitorLearnedQueries.firstSeenAt,
      lastSeenAt: monitorLearnedQueries.lastSeenAt,
      active: monitorLearnedQueries.active,
    })
    .from(monitorLearnedQueries)
    .leftJoin(talentProfiles, eq(talentProfiles.userId, monitorLearnedQueries.talentId))
    .orderBy(desc(monitorLearnedQueries.hitCount), desc(monitorLearnedQueries.lastSeenAt))
    .limit(500)
    .all();

  return NextResponse.json({ queries: rows });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const db = getDb();

  const body = (await req.json().catch(() => ({}))) as { id?: string; active?: boolean };
  if (!body.id || typeof body.active !== "boolean") {
    return NextResponse.json({ error: "id and active are required" }, { status: 400 });
  }

  await db
    .update(monitorLearnedQueries)
    .set({ active: body.active })
    .where(eq(monitorLearnedQueries.id, body.id));

  return NextResponse.json({ ok: true });
}
