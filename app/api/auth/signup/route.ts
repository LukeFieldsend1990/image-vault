export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { eq } from "drizzle-orm";

const VALID_ROLES = ["talent", "rep", "licensee"] as const;
type Role = (typeof VALID_ROLES)[number];

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; role?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, password, role } = body;

  if (!email || !password || !role) {
    return NextResponse.json({ error: "email, password, and role are required" }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  if (password.length < 12) {
    return NextResponse.json({ error: "Password must be at least 12 characters" }, { status: 400 });
  }

  if (!VALID_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const db = getDb();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .get();

  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = new Date();

  await db.insert(users).values({
    id: userId,
    email: email.toLowerCase(),
    passwordHash,
    role: role as Role,
    createdAt: now,
  });

  // Store setup token in KV (30 minute TTL)
  const setupToken = crypto.randomUUID();
  const kv = getRequestContext().env.SESSIONS_KV;
  await kv.put(
    `setup:${setupToken}`,
    JSON.stringify({ userId, email: email.toLowerCase(), role }),
    { expirationTtl: 1800 }
  );

  return NextResponse.redirect(
    new URL(`/setup-2fa?token=${setupToken}`, req.url),
    302
  );
}
