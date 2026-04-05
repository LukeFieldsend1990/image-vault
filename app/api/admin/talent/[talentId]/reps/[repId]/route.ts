export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, and } from "drizzle-orm";

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

  const admin = session.role === "admin" || isAdmin(session.email);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { talentId, repId } = await params;
  const db = getDb();

  await db
    .delete(talentReps)
    .where(and(eq(talentReps.talentId, talentId), eq(talentReps.repId, repId)));

  return new NextResponse(null, { status: 204 });
}
