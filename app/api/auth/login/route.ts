export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { users, totpCredentials } from "@/lib/db/schema";
import { verifyPassword, dummyPasswordCheck } from "@/lib/auth/password";
import { eq } from "drizzle-orm";

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
