import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { dismissCast } from "@/lib/productions/claim";

// POST /api/cast/dismiss
// Body: { castId: string }
// Persists a "Not me" dismissal so the placeholder never resurfaces for this talent.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as { castId?: string };
  if (!body.castId || typeof body.castId !== "string") {
    return NextResponse.json({ error: "castId required" }, { status: 400 });
  }

  const db = getDb();
  await dismissCast(db, session.sub, body.castId);
  return NextResponse.json({ ok: true });
}
