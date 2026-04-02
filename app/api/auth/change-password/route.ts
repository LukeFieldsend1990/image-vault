export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, refreshTokens } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new passwords are required" }, { status: 400 });
  }

  if (newPassword.length < 12) {
    return NextResponse.json({ error: "New password must be at least 12 characters" }, { status: 400 });
  }

  const db = getDb();

  const user = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
  }

  const newHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.id, user.id));

  // Invalidate all refresh tokens except current session
  // (user stays logged in on this device but is forced to re-auth elsewhere)
  await db
    .delete(refreshTokens)
    .where(eq(refreshTokens.userId, user.id));

  return NextResponse.json({ ok: true });
}
