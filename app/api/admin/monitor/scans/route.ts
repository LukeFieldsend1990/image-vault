import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { monitorScans, talentProfiles, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { timeOutStaleScans } from "@/lib/monitor/scan";
import { desc, eq } from "drizzle-orm";

// GET /api/admin/monitor/scans — recent sweep runs across all talents,
// including in-flight and failed ones. The Apify ledger only records actor
// runs that completed, so this is the one place an admin can see a sweep
// that is still running (or died) rather than just the ones that succeeded.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  // Settle dead runs first so "running" below always means live.
  await timeOutStaleScans(db);

  const rows = await db
    .select({
      id: monitorScans.id,
      talentId: monitorScans.talentId,
      trigger: monitorScans.trigger,
      status: monitorScans.status,
      platformsChecked: monitorScans.platformsChecked,
      candidatesAnalysed: monitorScans.candidatesAnalysed,
      hitsFound: monitorScans.hitsFound,
      aiProvider: monitorScans.aiProvider,
      error: monitorScans.error,
      startedAt: monitorScans.startedAt,
      completedAt: monitorScans.completedAt,
      talentName: talentProfiles.fullName,
      talentEmail: users.email,
    })
    .from(monitorScans)
    .leftJoin(users, eq(users.id, monitorScans.talentId))
    .leftJoin(talentProfiles, eq(talentProfiles.userId, monitorScans.talentId))
    .orderBy(desc(monitorScans.startedAt))
    .limit(30)
    .all();

  return NextResponse.json({
    runs: rows.map((r) => ({
      ...r,
      talentName: r.talentName ?? r.talentEmail ?? "Unknown talent",
      talentEmail: undefined,
    })),
  });
}
