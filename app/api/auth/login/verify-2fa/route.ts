export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { totpCredentials, refreshTokens } from "@/lib/db/schema";
import { verifyTotpCode } from "@/lib/auth/totp";
import { signSessionJwt } from "@/lib/auth/jwt";
import { generateToken, hashToken, setAuthCookies } from "@/lib/auth/session";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  let body: { pendingToken?: string; code?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { pendingToken, code } = body;
  if (!pendingToken || !code) {
    return NextResponse.json({ error: "pendingToken and code are required" }, { status: 400 });
  }

  const kv = getRequestContext().env.SESSIONS_KV;
  const kvKey = `pending:${pendingToken}`;
  const raw = await kv.get(kvKey);

  if (!raw) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  // Delete immediately to prevent replay
  await kv.delete(kvKey);

  const { userId, email, role } = JSON.parse(raw) as {
    userId: string;
    email: string;
    role: string;
  };

  const db = getDb();
  const totp = await db
    .select()
    .from(totpCredentials)
    .where(eq(totpCredentials.userId, userId))
    .get();

  if (!totp || !totp.verified) {
    return NextResponse.json({ error: "2FA not configured" }, { status: 400 });
  }

  const valid = verifyTotpCode(totp.secret, code);
  if (!valid) {
    return NextResponse.json({ error: "Invalid 2FA code" }, { status: 401 });
  }

  // Issue session JWT
  const secret = process.env.JWT_SECRET!;
  const sessionJwt = await signSessionJwt({ sub: userId, email, role }, secret);

  // Issue refresh token
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
