export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { buildTalentDashboard } from "@/lib/compliance/dashboard";
import { eq } from "drizzle-orm";

// GET /api/compliance/rep-overview
// Returns a compliance summary for every talent the authed rep manages.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "rep" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

  const roster = await db
    .select({
      talentId: talentReps.talentId,
      fullName: talentProfiles.fullName,
      profileImageUrl: talentProfiles.profileImageUrl,
    })
    .from(talentReps)
    .leftJoin(talentProfiles, eq(talentProfiles.userId, talentReps.talentId))
    .where(eq(talentReps.repId, session.sub))
    .all();

  const summaries = await Promise.all(
    roster.map(async (r) => {
      const data = await buildTalentDashboard(db, r.talentId, "sag_aftra");
      if (!data) return null;
      return {
        talentId: r.talentId,
        fullName: r.fullName,
        profileImageUrl: r.profileImageUrl ?? null,
        healthScore: data.healthScore,
        complianceStatus: data.complianceStatus,
        totalLicences: data.summary.totalLicences,
        totalProductions: data.summary.totalProductions,
        requiredGapsTotal: data.summary.requiredGapsTotal,
        activeStrikes: data.summary.activeStrikes,
        pendingTransfers: data.summary.pendingTransfers,
        actionCount: data.actionItems.filter((a) => a.urgency === "critical" || a.urgency === "soon").length,
      };
    }),
  );

  return NextResponse.json({ talent: summaries.filter(Boolean) });
}
