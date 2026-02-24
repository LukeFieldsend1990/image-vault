export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

/** GET /api/delegation — list reps linked to the authed talent */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const rows = await db
    .select({
      id: talentReps.id,
      repId: talentReps.repId,
      email: users.email,
      createdAt: talentReps.createdAt,
    })
    .from(talentReps)
    .innerJoin(users, eq(users.id, talentReps.repId))
    .where(eq(talentReps.talentId, session.sub))
    .all();

  return NextResponse.json({ reps: rows });
}

/** POST /api/delegation — invite a rep by email */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.email?.trim()) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const db = getDb();

  // Look up the rep user
  const rep = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, body.email.trim().toLowerCase()))
    .get();

  if (!rep) {
    return NextResponse.json({ error: "No account found with that email" }, { status: 404 });
  }
  if (rep.role !== "rep") {
    return NextResponse.json(
      { error: "That account is not registered as a representative" },
      { status: 422 }
    );
  }
  if (rep.id === session.sub) {
    return NextResponse.json({ error: "Cannot delegate to yourself" }, { status: 422 });
  }

  // Check not already linked
  const existing = await db
    .select({ id: talentReps.id })
    .from(talentReps)
    .where(and(eq(talentReps.talentId, session.sub), eq(talentReps.repId, rep.id)))
    .get();

  if (existing) {
    return NextResponse.json({ error: "Already linked" }, { status: 409 });
  }

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();

  await db.insert(talentReps).values({
    id,
    talentId: session.sub,
    repId: rep.id,
    invitedBy: session.sub,
    createdAt: now,
  });

  return NextResponse.json({ id, repId: rep.id, email: body.email.trim().toLowerCase() }, { status: 201 });
}
