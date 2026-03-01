export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { invites } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

// GET /api/invites/[token] — validate an invite token (public)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ valid: false, reason: "Missing token" });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const invite = await db
    .select()
    .from(invites)
    .where(eq(invites.id, token))
    .get();

  if (!invite) {
    return NextResponse.json({ valid: false, reason: "Invalid invite link" });
  }

  if (invite.usedAt !== null) {
    return NextResponse.json({ valid: false, reason: "This invite has already been used" });
  }

  if (invite.expiresAt < now) {
    return NextResponse.json({ valid: false, reason: "This invite link has expired" });
  }

  return NextResponse.json({
    valid: true,
    email: invite.email,
    role: invite.role,
  });
}

// DELETE /api/invites/[token] — revoke an invite
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { token } = await params;

  const db = getDb();

  const invite = await db
    .select()
    .from(invites)
    .where(eq(invites.id, token))
    .get();

  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  // Only the inviter or admin can revoke
  const isAdmin = session.role === "admin";
  const isOwner = invite.invitedBy === session.sub;
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (invite.usedAt !== null) {
    return NextResponse.json({ error: "Cannot revoke a used invite" }, { status: 409 });
  }

  await db.delete(invites).where(eq(invites.id, token));

  return NextResponse.json({ ok: true });
}
