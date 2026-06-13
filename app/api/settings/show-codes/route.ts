export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

// GET /api/settings/show-codes — current "code view mode" state for the caller
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const row = await db
    .select({ showCodes: users.showCodes })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();

  return NextResponse.json({ enabled: row?.showCodes ?? false });
}

// POST /api/settings/show-codes — toggle code view mode (self-serve, any role)
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { enabled?: boolean } = {};
  try { body = JSON.parse(await req.text()); } catch { /* ok */ }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) is required" }, { status: 400 });
  }

  const db = getDb();
  await db.update(users).set({ showCodes: body.enabled }).where(eq(users.id, session.sub));
  return NextResponse.json({ enabled: body.enabled });
}
