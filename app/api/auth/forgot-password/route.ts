export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, passwordResetTokens } from "@/lib/db/schema";
import { generateToken, hashToken } from "@/lib/auth/session";
import { dummyPasswordCheck } from "@/lib/auth/password";
import { sendEmail } from "@/lib/email/send";
import { passwordResetEmail } from "@/lib/email/templates";
import { eq } from "drizzle-orm";

const RESET_TTL_SECONDS = 30 * 60; // 30 minutes

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email } = body;
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const db = getDb();
  const normalEmail = email.toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  const user = await db
    .select({ id: users.id, email: users.email, suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.email, normalEmail))
    .get();

  if (!user || user.suspendedAt) {
    // Run dummy work to prevent timing-based user enumeration
    await dummyPasswordCheck();
    return NextResponse.json({ ok: true });
  }

  // Generate token
  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);

  await db.insert(passwordResetTokens).values({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash,
    expiresAt: now + RESET_TTL_SECONDS,
    createdAt: now,
  });

  // Build reset URL
  const origin = new URL(req.url).origin;
  const resetUrl = `${origin}/reset-password?token=${rawToken}`;

  const { subject, html } = passwordResetEmail({
    resetUrl,
    expiresInMinutes: RESET_TTL_SECONDS / 60,
  });

  await sendEmail({ to: user.email, subject, html });

  // Always return success to prevent enumeration
  return NextResponse.json({ ok: true });
}
