export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

/**
 * GET /api/admin/talent/[talentId]/reps
 * Returns the list of reps linked to this talent.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { talentId } = await params;
  const db = getDb();

  const rows = await db
    .select({
      repId: talentReps.repId,
      email: users.email,
      linkedSince: talentReps.createdAt,
    })
    .from(talentReps)
    .innerJoin(users, eq(users.id, talentReps.repId))
    .where(eq(talentReps.talentId, talentId))
    .all();

  return NextResponse.json({ reps: rows });
}

/**
 * POST /api/admin/talent/[talentId]/reps
 * Body: { repEmail: string }
 * Finds the rep user by email and links them to this talent.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { talentId } = await params;
  let body: { repEmail?: string } = {};
  try { body = await req.json(); } catch { /* ok */ }

  if (!body.repEmail?.trim()) {
    return NextResponse.json({ error: "repEmail is required" }, { status: 400 });
  }

  const db = getDb();

  const repUser = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, body.repEmail.trim().toLowerCase()))
    .get();

  if (!repUser) {
    return NextResponse.json({ error: "No user found with that email address." }, { status: 404 });
  }
  if (repUser.role !== "rep") {
    return NextResponse.json({ error: "That user is not a rep." }, { status: 409 });
  }

  // Check not already linked
  const existing = await db
    .select({ id: talentReps.id })
    .from(talentReps)
    .where(and(eq(talentReps.talentId, talentId), eq(talentReps.repId, repUser.id)))
    .get();

  if (existing) {
    return NextResponse.json({ error: "This rep is already linked to the talent." }, { status: 409 });
  }

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await db.insert(talentReps).values({
    id,
    talentId,
    repId: repUser.id,
    invitedBy: session.sub,
    createdAt: now,
  });

  const newRep = await db
    .select({ repId: talentReps.repId, email: users.email, linkedSince: talentReps.createdAt })
    .from(talentReps)
    .innerJoin(users, eq(users.id, talentReps.repId))
    .where(eq(talentReps.id, id))
    .get();

  return NextResponse.json({ rep: newRep }, { status: 201 });
}
