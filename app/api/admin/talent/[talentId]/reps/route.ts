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
