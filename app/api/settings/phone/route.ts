export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

// GET /api/settings/phone — return current user's phone
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const user = await db
    .select({ phone: users.phone })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();

  return NextResponse.json({ phone: user?.phone ?? null });
}

// PATCH /api/settings/phone — update current user's phone
export async function PATCH(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { phone?: string | null } = {};
  try {
    body = JSON.parse(await req.text());
  } catch { /* ok */ }

  const phone = body.phone;

  // Allow null or empty string to clear
  if (phone === null || phone === "" || phone === undefined) {
    const db = getDb();
    await db
      .update(users)
      .set({ phone: null })
      .where(eq(users.id, session.sub));

    return NextResponse.json({ ok: true });
  }

  if (typeof phone !== "string" || !E164_REGEX.test(phone)) {
    return NextResponse.json(
      { error: "phone must be in E.164 format (e.g. +447700900000)" },
      { status: 400 }
    );
  }

  const db = getDb();
  await db
    .update(users)
    .set({ phone })
    .where(eq(users.id, session.sub));

  return NextResponse.json({ ok: true });
}
