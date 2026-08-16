import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { getCrossClientOffenders, getRosterMonitorOverview } from "@/lib/monitor/rep-view";

/**
 * GET /api/roster/monitor — read-only roster-wide monitor view for reps:
 * per-client monitor status, coverage tier and hit summary, plus offender
 * accounts hitting two or more of this rep's clients. No mutating handlers
 * exist on this route by design.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "rep" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const [{ talents }, crossClientAccounts] = await Promise.all([
    getRosterMonitorOverview(db, session.sub),
    getCrossClientOffenders(db, session.sub),
  ]);
  return NextResponse.json({ talents, crossClientAccounts });
}
