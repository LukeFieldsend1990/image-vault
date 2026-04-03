export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { suggestions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and, isNull, gt, asc } from "drizzle-orm";

// GET /api/suggestions — unacknowledged, non-expired suggestions for current user
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const now = Math.floor(Date.now() / 1000);
  const db = getDb();

  const rows = await db
    .select()
    .from(suggestions)
    .where(
      and(
        eq(suggestions.userId, session.sub),
        isNull(suggestions.acknowledgedAt),
        gt(suggestions.expiresAt, now)
      )
    )
    .orderBy(asc(suggestions.priority))
    .limit(20)
    .all();

  return NextResponse.json({ suggestions: rows });
}
