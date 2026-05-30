export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { usageEvents, royaltySources } from "@/lib/db/schema";
import { and, eq, gte, sum, count, desc, sql } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasRepAccess } from "@/lib/auth/repAccess";

/**
 * GET /api/royalties/summary[?talentId=]
 * Aggregates usage_events into the talent's Royalty Hub view: lifetime / today /
 * last-24h talent earnings, a 24-bucket sparkline, per-source and per-usage-type
 * breakdowns, and a recent event feed. All amounts are the TALENT share in pence.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  // Resolve which talent's feed to show.
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

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const startOfDay = Math.floor(now / 86400) * 86400; // UTC midnight
  const dayAgo = now - 86400;

  const byTalent = eq(usageEvents.talentId, talentId);

  const [lifetime, today, last24h, bySource, byUsageType, recent, sparkRows] = await Promise.all([
    db.select({ pence: sum(usageEvents.talentPence), events: count(usageEvents.id) })
      .from(usageEvents).where(byTalent).get(),

    db.select({ pence: sum(usageEvents.talentPence) })
      .from(usageEvents).where(and(byTalent, gte(usageEvents.recordedAt, startOfDay))).get(),

    db.select({ pence: sum(usageEvents.talentPence) })
      .from(usageEvents).where(and(byTalent, gte(usageEvents.recordedAt, dayAgo))).get(),

    db.select({
        sourceId: usageEvents.sourceId,
        name: royaltySources.displayName,
        pence: sum(usageEvents.talentPence),
        events: count(usageEvents.id),
      })
      .from(usageEvents)
      .innerJoin(royaltySources, eq(royaltySources.id, usageEvents.sourceId))
      .where(byTalent)
      .groupBy(usageEvents.sourceId, royaltySources.displayName)
      .orderBy(desc(sum(usageEvents.talentPence)))
      .all(),

    db.select({
        type: usageEvents.eventType,
        pence: sum(usageEvents.talentPence),
        events: count(usageEvents.id),
      })
      .from(usageEvents)
      .where(byTalent)
      .groupBy(usageEvents.eventType)
      .orderBy(desc(sum(usageEvents.talentPence)))
      .all(),

    db.select({
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
      .where(byTalent)
      .orderBy(desc(usageEvents.recordedAt))
      .limit(15)
      .all(),

    // Hourly bucket index (0..23) within the last 24h, summed.
    db.select({
        bucket: sql<number>`(${usageEvents.recordedAt} - ${dayAgo}) / 3600`,
        pence: sum(usageEvents.talentPence),
      })
      .from(usageEvents)
      .where(and(byTalent, gte(usageEvents.recordedAt, dayAgo)))
      .groupBy(sql`(${usageEvents.recordedAt} - ${dayAgo}) / 3600`)
      .all(),
  ]);

  // Densify the sparkline into 24 hourly buckets.
  const sparkline = new Array(24).fill(0) as number[];
  for (const r of sparkRows) {
    const idx = Math.max(0, Math.min(23, Math.floor(Number(r.bucket))));
    sparkline[idx] += Number(r.pence ?? 0);
  }

  return NextResponse.json({
    currency: "GBP",
    lifetimePence: Number(lifetime?.pence ?? 0),
    eventCount: Number(lifetime?.events ?? 0),
    todayPence: Number(today?.pence ?? 0),
    last24hPence: Number(last24h?.pence ?? 0),
    bySource: bySource.map((r) => ({
      sourceId: r.sourceId,
      name: r.name,
      pence: Number(r.pence ?? 0),
      events: Number(r.events ?? 0),
    })),
    byUsageType: byUsageType.map((r) => ({
      type: r.type,
      pence: Number(r.pence ?? 0),
      events: Number(r.events ?? 0),
    })),
    sparkline,
    recent: recent.map((r) => ({
      id: r.id,
      source: r.source,
      units: r.units,
      eventType: r.eventType,
      talentPence: r.talentPence,
      occurredAt: r.occurredAt,
      recordedAt: r.recordedAt,
    })),
    hasMore: recent.length === 15,
  });
}
