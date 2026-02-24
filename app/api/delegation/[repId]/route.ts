export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { and, eq } from "drizzle-orm";

/** DELETE /api/delegation/:repId — remove a rep from the authed talent's delegation */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ repId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { repId } = await params;
  const db = getDb();

  const row = await db
    .select({ id: talentReps.id })
    .from(talentReps)
    .where(and(eq(talentReps.talentId, session.sub), eq(talentReps.repId, repId)))
    .get();

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .delete(talentReps)
    .where(and(eq(talentReps.talentId, session.sub), eq(talentReps.repId, repId)));

  return NextResponse.json({ ok: true });
}
