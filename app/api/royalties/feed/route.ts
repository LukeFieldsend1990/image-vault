export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { usageEvents, royaltySources } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasRepAccess } from "@/lib/auth/repAccess";

const PAGE_SIZE = 25;

/**
 * GET /api/royalties/feed?offset=0[&talentId=]
 * Paginates usage_events for the talent's live feed.
 * Returns PAGE_SIZE rows + hasMore flag.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const requested = req.nextUrl.searchParams.get("talentId");
  let talentId = session.sub;
  if (requested && requested !== session.sub) {
    if (isAdmin(session.email)) {
      talentId = requested;
    } else if (session.role === "rep" && (await hasRepAccess(session.sub, requested))) {
      talentId = requested;
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
  const db = getDb();

  const rows = await db
    .select({
      id: usageEvents.id,
      source: royaltySources.displayName,
      units: usageEvents.units,
      eventType: usageEvents.eventType,
      talentPence: usageEvents.talentPence,
      occurredAt: usageEvents.occurredAt,
      recordedAt: usageEvents.recordedAt,
    })
    .from(usageEvents)
    .innerJoin(royaltySources, eq(royaltySources.id, usageEvents.sourceId))
    .where(eq(usageEvents.talentId, talentId))
    .orderBy(desc(usageEvents.recordedAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset)
    .all();

  const hasMore = rows.length > PAGE_SIZE;
  return NextResponse.json({
    events: rows.slice(0, PAGE_SIZE),
    hasMore,
    nextOffset: hasMore ? offset + PAGE_SIZE : null,
  });
}
