import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { UNION_PRESETS, getUnionPreset } from "@/lib/compliance/unions";
import { buildDeepfakeHitStats } from "@/lib/monitor/hit-stats";
import { platformCohort, unionCohort } from "@/lib/monitor/stat-cohorts";

/**
 * GET /api/admin/monitor/deepfake-stats?unionId=
 *
 * The same report the union and rep surfaces render, at admin scope. Without
 * `unionId` the cohort is every talent profile on the platform; with one it is
 * that union's affiliated members, which is what lets an admin see exactly what
 * a given union sees before answering a question about it.
 *
 * Admin scope carries no privacy filter to apply — an admin already reaches
 * every hit through the rest of this console — so the payload is the plain
 * report. Read-only: no mutating handlers on this route.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const requested = new URL(req.url).searchParams.get("unionId");
  const unionId = requested && getUnionPreset(requested) ? requested : null;

  const cohort = unionId ? await unionCohort(db, unionId) : await platformCohort(db);
  const stats = await buildDeepfakeHitStats(db, cohort);

  return NextResponse.json({
    scope: {
      kind: "admin",
      label: unionId ? (getUnionPreset(unionId)?.shortName ?? unionId) : "All talent",
      memberNoun: "talent",
      unionId,
      available: UNION_PRESETS.map((u) => ({ id: u.id, shortName: u.shortName })),
    },
    stats,
  });
}
