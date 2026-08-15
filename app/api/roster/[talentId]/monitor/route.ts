import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { getTalentMonitorForRep } from "@/lib/monitor/rep-view";

/**
 * GET /api/roster/:talentId/monitor — read-only monitor detail for one
 * managed talent. Rep-only, gated on the talent_reps link (404 without it,
 * same shape as the other roster routes). Secondary actors are sanitised
 * so non-roster talents' platform membership never reaches the rep.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "rep") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { talentId } = await params;
  const db = getDb();

  const link = await db
    .select({ id: talentReps.id })
    .from(talentReps)
    .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, talentId)))
    .get();
  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(await getTalentMonitorForRep(db, session.sub, talentId));
}
