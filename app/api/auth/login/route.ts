export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { users, totpCredentials } from "@/lib/db/schema";
import { verifyPassword, dummyPasswordCheck } from "@/lib/auth/password";
import { checkRateLimit, getClientIp } from "@/lib/auth/rateLimit";
import { eq } from "drizzle-orm";

const LOGIN_LIMIT = { action: "login", maxAttempts: 10, windowSeconds: 900 };

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  // Rate limit: 10 attempts per 15 minutes per IP
  const rl = await checkRateLimit(getClientIp(req), LOGIN_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const db = getDb();

  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .get();

  if (!user) {
    // Constant-time dummy check to prevent user enumeration
    await dummyPasswordCheck();
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (user.suspendedAt !== null && user.suspendedAt !== undefined) {
    return NextResponse.json({ error: "This account has been suspended. Please contact support." }, { status: 403 });
  }

  // Check for verified TOTP
  const totp = await db
    .select()
    .from(totpCredentials)
    .where(eq(totpCredentials.userId, user.id))
    .get();

  if (!totp || !totp.verified) {
    // User hasn't completed 2FA setup — issue a setup token and redirect
    const setupToken = crypto.randomUUID();
    const kv = getRequestContext().env.SESSIONS_KV;
    await kv.put(
      `setup:${setupToken}`,
      JSON.stringify({ userId: user.id, email: user.email, role: user.role }),
      { expirationTtl: 1800 }
    );
    return NextResponse.json({ redirect: `/setup-2fa?token=${setupToken}` }, { status: 200 });
  }

  // Issue pending token for TOTP verification
  const pendingToken = crypto.randomUUID();
  const kv = getRequestContext().env.SESSIONS_KV;
  await kv.put(
    `pending:${pendingToken}`,
    JSON.stringify({ userId: user.id, email: user.email, role: user.role }),
    { expirationTtl: 300 }
  );

  return NextResponse.json({ pendingToken }, { status: 200 });
}
