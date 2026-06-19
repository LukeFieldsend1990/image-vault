import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { bridgeEvents, scanPackages, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { sql, inArray } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

  const events = await db
    .select({
      id:        bridgeEvents.id,
      grantId:   bridgeEvents.grantId,
      packageId: bridgeEvents.packageId,
      deviceId:  bridgeEvents.deviceId,
      userId:    bridgeEvents.userId,
      eventType: bridgeEvents.eventType,
      severity:  bridgeEvents.severity,
      detail:    bridgeEvents.detail,
      createdAt: bridgeEvents.createdAt,
    })
    .from(bridgeEvents)
    .orderBy(sql`${bridgeEvents.createdAt} desc`)
    .limit(100)
    .all();

  const pkgIds = [...new Set(events.map(e => e.packageId).filter(id => id !== "_lifecycle_"))];
  const pkgRows = pkgIds.length > 0
    ? await db.select({ id: scanPackages.id, name: scanPackages.name })
        .from(scanPackages).where(inArray(scanPackages.id, pkgIds)).all()
    : [];

  const userIds = [...new Set(events.map(e => e.userId).filter((id): id is string => id !== null))];
  const userRows = userIds.length > 0
    ? await db.select({ id: users.id, email: users.email }).from(users)
        .where(inArray(users.id, userIds)).all()
    : [];

  return NextResponse.json({
    events,
    pkgNames:   Object.fromEntries(pkgRows.map(p => [p.id, p.name])),
    userEmails: Object.fromEntries(userRows.map(u => [u.id, u.email])),
  });
}
