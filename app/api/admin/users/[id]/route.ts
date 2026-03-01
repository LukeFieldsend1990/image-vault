export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, refreshTokens } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

async function requireAdminSession(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!ADMIN_EMAILS.includes(session.email ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

// PATCH /api/admin/users/[id] — suspend or unsuspend a user
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireAdminSession(req);
  if (isErrorResponse(session)) return session;
  if (session instanceof NextResponse) return session;

  let body: { suspended?: boolean } = {};
  try {
    body = JSON.parse(await req.text());
  } catch { /* ok */ }

  if (typeof body.suspended !== "boolean") {
    return NextResponse.json({ error: "suspended (boolean) is required" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  await db
    .update(users)
    .set({ suspendedAt: body.suspended ? now : null })
    .where(eq(users.id, id));

  // Revoke all refresh tokens so the suspended user is immediately logged out
  if (body.suspended) {
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, id));
  }

  return NextResponse.json({ suspended: body.suspended });
}

// DELETE /api/admin/users/[id] — permanently delete a user
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireAdminSession(req);
  if (isErrorResponse(session)) return session;
  if (session instanceof NextResponse) return session;

  const db = getDb();
  await db.delete(users).where(eq(users.id, id));

  return NextResponse.json({ deleted: true });
}
