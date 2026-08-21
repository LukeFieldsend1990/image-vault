import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { buildDeepfakeHitStats } from "@/lib/monitor/hit-stats";
import { repRosterCohort } from "@/lib/monitor/stat-cohorts";

/**
 * GET /api/roster/deepfake-stats — lifetime / this-month / growth / per-client
 * deepfake hit statistics across the talent a rep manages.
 *
 * Counts only. The rep's route into hit detail stays /api/roster/monitor, which
 * already applies the secondary-actor sanitisation; nothing here returns hit
 * content. Read-only by design — no mutating handlers on this route.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "rep" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const cohort = await repRosterCohort(db, session.sub);
  const stats = await buildDeepfakeHitStats(db, cohort);

  return NextResponse.json({
    scope: { kind: "roster", label: "My roster", memberNoun: "client" },
    stats,
  });
}
