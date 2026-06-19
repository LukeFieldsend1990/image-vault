import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

// DELETE /api/organisations/[id]/members/[userId] — remove a member (owner/admin only)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id, userId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const [callerMembership] = await db
    .select({ memberRole: organisationMembers.memberRole })
    .from(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, session.sub)))
    .limit(1)
    .all();

  const isOrgAdmin = callerMembership?.memberRole === "owner" || callerMembership?.memberRole === "admin";
  // Allow self-removal (leaving org) or admin action
  if (!isOrgAdmin && session.role !== "admin" && session.sub !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Prevent removing the only owner
  if (callerMembership?.memberRole === "owner" && session.sub === userId) {
    const owners = await db
      .select({ userId: organisationMembers.userId })
      .from(organisationMembers)
      .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.memberRole, "owner")))
      .all();
    if (owners.length <= 1) {
      return NextResponse.json({ error: "Cannot remove the only owner. Transfer ownership first." }, { status: 409 });
    }
  }

  await db
    .delete(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, userId)));

  return NextResponse.json({ ok: true });
}

// PATCH /api/organisations/[id]/members/[userId] — change a member's role (owner only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id, userId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const [callerMembership] = await db
    .select({ memberRole: organisationMembers.memberRole })
    .from(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, session.sub)))
    .limit(1)
    .all();

  if (callerMembership?.memberRole !== "owner" && session.role !== "admin") {
    return NextResponse.json({ error: "Only the owner can change member roles" }, { status: 403 });
  }

  let body: { memberRole?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowed = ["owner", "admin", "member"];
  if (!body.memberRole || !allowed.includes(body.memberRole)) {
    return NextResponse.json({ error: "memberRole must be owner | admin | member" }, { status: 400 });
  }

  await db
    .update(organisationMembers)
    .set({ memberRole: body.memberRole as "owner" | "admin" | "member" })
    .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, userId)));

  return NextResponse.json({ ok: true });
}
