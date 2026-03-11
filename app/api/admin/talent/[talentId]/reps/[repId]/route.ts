export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

/**
 * DELETE /api/admin/talent/[talentId]/reps/[repId]
 * Unlinks a rep from a talent.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string; repId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { talentId, repId } = await params;
  const db = getDb();

  await db
    .delete(talentReps)
    .where(and(eq(talentReps.talentId, talentId), eq(talentReps.repId, repId)));

  return new NextResponse(null, { status: 204 });
}
