import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isComplianceRole } from "@/lib/auth/roles";
import { isAdmin } from "@/lib/auth/adminEmails";
import { resolveRosterUnion, rosterCoverageByUnion } from "@/lib/compliance/members";
import { getUnionPreset } from "@/lib/compliance/unions";
import { buildDeepfakeHitStats } from "@/lib/monitor/hit-stats";
import { unionCohort } from "@/lib/monitor/stat-cohorts";

/**
 * GET /api/compliance/union/deepfake-stats?unionId=
 * Deepfake hit statistics for the members affiliated with one union: lifetime
 * totals, the month in progress, growth, and a per-member breakdown.
 *
 * Union-bound the same way the member roster is (`resolveRosterUnion`): a
 * platform- or union-scoped union grant, or admin. A regulator's platform-wide
 * grant confers no union and is refused — this is a union's view of its own
 * members, not a cross-union oversight surface.
 *
 * Counts only, never hit content. A union sees that a member is carrying
 * eleven hits; the eleven URLs stay with the talent and their rep.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isComplianceRole(session.role) && !isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const requested = new URL(req.url).searchParams.get("unionId");
  const resolved = await resolveRosterUnion(db, session, requested);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const { available, unionId } = resolved;
  const preset = getUnionPreset(unionId);

  const [cohort, coverage] = await Promise.all([
    unionCohort(db, unionId),
    rosterCoverageByUnion(db),
  ]);
  const stats = await buildDeepfakeHitStats(db, cohort);

  return NextResponse.json({
    scope: {
      kind: "union",
      label: preset?.shortName ?? unionId,
      memberNoun: "member",
      unionId,
      available,
      // Roster context: the cohort above is on-platform members only, so the
      // totals below are what tells a union how much of its membership these
      // numbers can possibly speak for.
      roster: coverage[unionId] ?? { total: 0, onPlatform: 0, coveragePct: 0 },
    },
    stats,
  });
}
