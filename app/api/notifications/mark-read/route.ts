export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { and, eq, inArray } from "drizzle-orm";

// POST /api/notifications/mark-read — mark all (or a given list of) notifications read
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { ids?: string[] } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDb();
  const scope = body.ids && body.ids.length > 0
    ? and(eq(notifications.userId, session.sub), inArray(notifications.id, body.ids))
    : eq(notifications.userId, session.sub);

  await db.update(notifications).set({ read: true }).where(scope);

  return NextResponse.json({ ok: true });
}
