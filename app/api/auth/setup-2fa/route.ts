export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { totpCredentials, refreshTokens } from "@/lib/db/schema";
import { generateTotpSecret, buildOtpauthUrl, verifyTotpCode } from "@/lib/auth/totp";
import { signSessionJwt } from "@/lib/auth/jwt";
import { generateToken, hashToken, setAuthCookies } from "@/lib/auth/session";
import { checkRateLimit, getClientIp } from "@/lib/auth/rateLimit";
import { eq } from "drizzle-orm";

const SETUP_2FA_LIMIT = { action: "setup-2fa", maxAttempts: 5, windowSeconds: 300 };

/** GET /api/auth/setup-2fa?token=<uuid>
 *  Returns { otpauthUrl, secret } — idempotent (reuses existing unverified secret)
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const kv = getRequestContext().env.SESSIONS_KV;
  const raw = await kv.get(`setup:${token}`);
  if (!raw) {
    return NextResponse.json({ error: "Invalid or expired setup token" }, { status: 401 });
  }

  const { userId, email } = JSON.parse(raw) as { userId: string; email: string; role: string };
  const db = getDb();

  // Idempotent: reuse existing unverified TOTP secret if present
  const existing = await db
    .select()
    .from(totpCredentials)
    .where(eq(totpCredentials.userId, userId))
    .get();

  if (existing?.verified) {
    return NextResponse.json({ error: "2FA already configured" }, { status: 409 });
  }

  let secret: string;
  if (existing) {
    secret = existing.secret;
  } else {
    secret = generateTotpSecret();
    await db.insert(totpCredentials).values({
      id: crypto.randomUUID(),
      userId,
      secret,
      verified: false,
      createdAt: new Date(),
    });
  }

  const otpauthUrl = buildOtpauthUrl(email, secret);
  return NextResponse.json({ otpauthUrl, secret }, { status: 200 });
}

/** POST /api/auth/setup-2fa
 *  Body: { token, code }
 *  Verifies first TOTP code, marks cred verified, issues session
 */
export async function POST(req: NextRequest) {
  let body: { token?: string; code?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { token, code } = body;
  if (!token || !code) {
    return NextResponse.json({ error: "token and code are required" }, { status: 400 });
  }

  // Rate limit: 5 attempts per 5 minutes per IP
  const rl = await checkRateLimit(getClientIp(req), SETUP_2FA_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const kv = getRequestContext().env.SESSIONS_KV;
  const kvKey = `setup:${token}`;
  const raw = await kv.get(kvKey);
  if (!raw) {
    return NextResponse.json({ error: "Invalid or expired setup token" }, { status: 401 });
  }

  const { userId, email, role } = JSON.parse(raw) as { userId: string; email: string; role: string };
  const db = getDb();

  const totp = await db
    .select()
    .from(totpCredentials)
    .where(eq(totpCredentials.userId, userId))
    .get();

  if (!totp) {
    return NextResponse.json({ error: "No TOTP secret found. Refresh the QR page." }, { status: 400 });
  }

  if (totp.verified) {
    return NextResponse.json({ error: "2FA already configured" }, { status: 409 });
  }

  const valid = verifyTotpCode(totp.secret, code);
  if (!valid) {
    return NextResponse.json({ error: "Invalid 2FA code" }, { status: 401 });
  }

  // Mark verified
  await db
    .update(totpCredentials)
    .set({ verified: true })
    .where(eq(totpCredentials.id, totp.id));

  // Delete setup token
  await kv.delete(kvKey);

  // Issue session + refresh
  const jwtSecret = process.env.JWT_SECRET!;
  const sessionJwt = await signSessionJwt({ sub: userId, email, role }, jwtSecret);

  const rawRefresh = generateToken();
  const tokenHash = await hashToken(rawRefresh);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    expiresAt,
    createdAt: now,
  });

  const response = NextResponse.json({ ok: true }, { status: 200 });
  setAuthCookies(response, sessionJwt, rawRefresh);
  return response;
}
