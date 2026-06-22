import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { and, eq, desc, inArray } from "drizzle-orm";

// Production-side events that make the "self-healing roster" visible on the
// industry dashboard — reserved roles filling themselves in, plus licence
// outcomes. These are the notifications a production-company user receives.
const PRODUCTION_ACTIVITY_TYPES = [
  "cast_claimed", // Path D — talent joined and claimed a reserved role
  "cast_rep_filled", // Path C — an agency filled a reserved role for their client
  "licence_approved",
  "licence_denied",
];

// GET /api/productions/activity — recent production activity for the caller.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const items = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, session.sub), inArray(notifications.type, PRODUCTION_ACTIVITY_TYPES)))
    .orderBy(desc(notifications.createdAt))
    .limit(12)
    .all();

  return NextResponse.json({ activity: items });
}
