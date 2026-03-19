export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps, licences, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and, inArray, sum, count, desc } from "drizzle-orm";

/** GET /api/roster/revenue — aggregated licence revenue across all roster talent */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "rep" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

  const talentRows = await db
    .select({ talentId: talentReps.talentId })
    .from(talentReps)
    .where(eq(talentReps.repId, session.sub))
    .all();

  const talentIds = talentRows.map((r) => r.talentId);

  if (talentIds.length === 0) {
    return NextResponse.json({
      summary: { grossPence: 0, agencyPence: 0, platformPence: 0, talentPence: 0, licenceCount: 0 },
      licences: [],
    });
  }

  const [totals, licenceRows] = await Promise.all([
    db
      .select({ gross: sum(licences.agreedFee), licenceCount: count(licences.id) })
      .from(licences)
      .where(and(inArray(licences.talentId, talentIds), eq(licences.status, "APPROVED")))
      .get(),

    db
      .select({
        id: licences.id,
        talentName: talentProfiles.fullName,
        projectName: licences.projectName,
        productionCompany: licences.productionCompany,
        licenceType: licences.licenceType,
        territory: licences.territory,
        status: licences.status,
        agreedFee: licences.agreedFee,
        approvedAt: licences.approvedAt,
      })
      .from(licences)
      .leftJoin(talentProfiles, eq(talentProfiles.userId, licences.talentId))
      .where(inArray(licences.talentId, talentIds))
      .orderBy(desc(licences.createdAt))
      .all(),
  ]);

  const grossPence = Number(totals?.gross ?? 0);
  const agencyPence = Math.round(grossPence * 0.2);
  const platformPence = Math.round(grossPence * 0.15);
  const talentPence = grossPence - agencyPence - platformPence;

  return NextResponse.json({
    summary: { grossPence, agencyPence, platformPence, talentPence, licenceCount: totals?.licenceCount ?? 0 },
    licences: licenceRows,
  });
}
