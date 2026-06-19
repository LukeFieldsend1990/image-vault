import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { and, eq, desc, sql } from "drizzle-orm";

// GET /api/notifications — recent notifications + unread count for the session user
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const [items, unread] = await Promise.all([
    db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        href: notifications.href,
        read: notifications.read,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, session.sub))
      .orderBy(desc(notifications.createdAt))
      .limit(30)
      .all(),
    db
      .select({ n: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, session.sub), eq(notifications.read, false)))
      .get(),
  ]);

  return NextResponse.json({ notifications: items, unreadCount: unread?.n ?? 0 });
}
