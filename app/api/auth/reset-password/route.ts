export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, passwordResetTokens, refreshTokens } from "@/lib/db/schema";
import { hashToken } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { eq, and, isNull, gt } from "drizzle-orm";

export async function POST(req: NextRequest) {
  let body: { token?: string; password?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { token, password } = body;
  if (!token || !password) {
    return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
  }

  if (password.length < 12) {
    return NextResponse.json({ error: "Password must be at least 12 characters" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const tokenHash = await hashToken(token);

  // Find valid, unused token
  const resetToken = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now)
      )
    )
    .get();

  if (!resetToken) {
    return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
  }

  // Update password
  const newHash = await hashPassword(password);
  await db
    .update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.id, resetToken.userId));

  // Mark token as used
  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(eq(passwordResetTokens.id, resetToken.id));

  // Invalidate all refresh tokens (force re-login on all devices)
  await db
    .delete(refreshTokens)
    .where(eq(refreshTokens.userId, resetToken.userId));

  return NextResponse.json({ ok: true });
}
