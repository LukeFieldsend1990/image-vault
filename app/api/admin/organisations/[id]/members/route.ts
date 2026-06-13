export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { eq, and } from "drizzle-orm";

// POST /api/admin/organisations/[id]/members — assign a licensee user to an org (bypasses invite)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { userId?: string; memberRole?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const db = getDb();

  const [org] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.id, id))
    .limit(1)
    .all();

  if (!org) {
    return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  }

  const [targetUser] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, body.userId))
    .limit(1)
    .all();

  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!isIndustryRole(targetUser.role)) {
    return NextResponse.json({ error: "Only licensee users can be added to organisations" }, { status: 400 });
  }

  const allowed = ["owner", "admin", "member"];
  const memberRole = (body.memberRole && allowed.includes(body.memberRole))
    ? body.memberRole as "owner" | "admin" | "member"
    : "member";

  // Upsert — if already a member, update their role
  const [existing] = await db
    .select({ userId: organisationMembers.userId })
    .from(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, body.userId)))
    .limit(1)
    .all();

  const now = Math.floor(Date.now() / 1000);

  if (existing) {
    await db
      .update(organisationMembers)
      .set({ memberRole })
      .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, body.userId)));
  } else {
    await db.insert(organisationMembers).values({
      organisationId: id,
      userId: body.userId,
      memberRole,
      invitedBy: session.sub,
      joinedAt: now,
    });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/organisations/[id]/members — remove a user from an org
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { userId?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const db = getDb();

  await db
    .delete(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, body.userId)));

  return NextResponse.json({ ok: true });
}
