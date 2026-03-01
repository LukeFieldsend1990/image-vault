export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { users, invites, talentReps } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { eq, and, isNull, gt } from "drizzle-orm";

const VALID_ROLES = ["talent", "rep", "licensee"] as const;
type Role = (typeof VALID_ROLES)[number];

// Roles that require an invite token
const INVITE_REQUIRED_ROLES: Role[] = ["talent", "rep"];

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; role?: string; inviteToken?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, password, role, inviteToken } = body;

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
  const normalEmail = email.toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  // Validate invite token for talent and rep roles
  let inviteRow: typeof invites.$inferSelect | undefined;

  if (INVITE_REQUIRED_ROLES.includes(role as Role)) {
    if (!inviteToken) {
      return NextResponse.json(
        { error: "An invitation is required to register as Talent or Representative" },
        { status: 403 }
      );
    }

    inviteRow = await db
      .select()
      .from(invites)
      .where(eq(invites.id, inviteToken))
      .get();

    if (!inviteRow) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 403 });
    }

    if (inviteRow.usedAt !== null) {
      return NextResponse.json({ error: "This invite has already been used" }, { status: 403 });
    }

    if (inviteRow.expiresAt < now) {
      return NextResponse.json({ error: "This invite link has expired" }, { status: 403 });
    }

    if (inviteRow.email !== normalEmail) {
      return NextResponse.json({ error: "This invite was sent to a different email address" }, { status: 403 });
    }

    if (inviteRow.role !== role) {
      return NextResponse.json({ error: "This invite is for a different account type" }, { status: 403 });
    }
  } else if (inviteToken) {
    // Licensee with optional invite — validate if provided but don't require it
    const maybeInvite = await db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.id, inviteToken),
          isNull(invites.usedAt),
          gt(invites.expiresAt, now)
        )
      )
      .get();

    if (maybeInvite && maybeInvite.email === normalEmail && maybeInvite.role === role) {
      inviteRow = maybeInvite;
    }
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalEmail))
    .get();

  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const nowDate = new Date();

  await db.insert(users).values({
    id: userId,
    email: normalEmail,
    passwordHash,
    role: role as Role,
    createdAt: nowDate,
  });

  // Mark invite as used
  if (inviteRow) {
    await db
      .update(invites)
      .set({ usedAt: now })
      .where(eq(invites.id, inviteRow.id));

    // Auto-link rep to inviting talent if talentId is set
    if (role === "rep" && inviteRow.talentId) {
      await db.insert(talentReps).values({
        id: crypto.randomUUID(),
        talentId: inviteRow.talentId,
        repId: userId,
        invitedBy: inviteRow.invitedBy,
        createdAt: now,
      });
    }
  }

  // Store setup token in KV (30 minute TTL)
  const setupToken = crypto.randomUUID();
  const kv = getRequestContext().env.SESSIONS_KV;
  await kv.put(
    `setup:${setupToken}`,
    JSON.stringify({ userId, email: normalEmail, role }),
    { expirationTtl: 1800 }
  );

  return NextResponse.redirect(
    new URL(`/setup-2fa?token=${setupToken}`, req.url),
    302
  );
}
