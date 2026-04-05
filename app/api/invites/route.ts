export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { invites, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, and, isNull, gt, inArray } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { inviteEmail } from "@/lib/email/templates";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

// GET /api/invites — admin: list all invites; talent: list own invites
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const { searchParams } = new URL(req.url);
  const roleFilter = searchParams.get("role"); // optional: filter by role

  let rows;
  if (isAdmin(session.email)) {
    rows = await db.select().from(invites).orderBy(invites.createdAt).all();
  } else if (session.role === "talent") {
    const query = db
      .select()
      .from(invites)
      .where(
        roleFilter
          ? and(
              eq(invites.invitedBy, session.sub),
              eq(invites.role, roleFilter as "talent" | "rep" | "licensee")
            )
          : eq(invites.invitedBy, session.sub)
      );
    rows = await query.orderBy(invites.createdAt).all();
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Resolve inviter emails
  const inviterIds = Array.from(new Set(rows.map((r) => r.invitedBy)));
  const inviterRows = inviterIds.length > 0
    ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, inviterIds)).all()
    : [];
  const emailMap = new Map(inviterRows.map((u) => [u.id, u.email]));

  const result = rows.map((r) => ({
    ...r,
    invitedByEmail: emailMap.get(r.invitedBy) ?? null,
    status: r.usedAt
      ? "used"
      : r.expiresAt < now
        ? "expired"
        : "pending",
  }));

  return NextResponse.json({ invites: result });
}

// POST /api/invites — create an invite
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (!isAdmin(session.email) && session.role !== "talent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email?: string; role?: string; message?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, role, message } = body;

  if (!email || !role) {
    return NextResponse.json({ error: "email and role are required" }, { status: 400 });
  }

  if (!["talent", "rep", "licensee"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Talent can only invite rep or licensee; admins can invite any role
  if (!isAdmin(session.email) && session.role === "talent" && role === "talent") {
    return NextResponse.json({ error: "Talent accounts can only invite reps or licensees" }, { status: 403 });
  }

  const db = getDb();
  const normalEmail = email.toLowerCase().trim();
  const now = Math.floor(Date.now() / 1000);

  // Check for existing user with that email
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalEmail))
    .get();

  if (existingUser) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  // Check for existing pending invite to same email
  const existingInvite = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        eq(invites.email, normalEmail),
        isNull(invites.usedAt),
        gt(invites.expiresAt, now)
      )
    )
    .get();

  if (existingInvite) {
    return NextResponse.json({ error: "A pending invite already exists for that email" }, { status: 409 });
  }

  const inviteId = crypto.randomUUID();
  const expiresAt = now + SEVEN_DAYS;

  await db.insert(invites).values({
    id: inviteId,
    email: normalEmail,
    role: role as "talent" | "rep" | "licensee",
    invitedBy: session.sub,
    talentId: session.role === "talent" && role === "rep" ? session.sub : null,
    message: message?.trim() ?? null,
    usedAt: null,
    expiresAt,
    createdAt: now,
  });

  // Send invite email
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
  const { subject, html } = inviteEmail({
    to: normalEmail,
    inviterEmail: session.email,
    role: role as "talent" | "rep" | "licensee",
    message: message?.trim() ?? null,
    signupUrl: `${baseUrl}/signup?invite=${inviteId}`,
    expiresAt,
  });
  await sendEmail({ to: normalEmail, subject, html });

  return NextResponse.json({ inviteId }, { status: 201 });
}
