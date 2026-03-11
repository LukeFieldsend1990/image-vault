export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps, licences, users, talentSettings } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and, sum, count } from "drizzle-orm";

async function assertRepAccess(repId: string, talentId: string) {
  const db = getDb();
  const link = await db
    .select({ id: talentReps.id })
    .from(talentReps)
    .where(and(eq(talentReps.repId, repId), eq(talentReps.talentId, talentId)))
    .get();
  return !!link;
}

/**
 * GET /api/roster/[talentId]/revenue
 * Returns licence revenue breakdown for a single talent:
 * - Summary totals: gross / talent share / agency / platform
 * - Per-licence history: project, company, type, territory, agreedFee, status, approvedAt
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { talentId } = await params;

  if (session.role === "rep") {
    const ok = await assertRepAccess(session.sub, talentId);
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (session.role === "talent") {
    if (session.sub !== talentId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

  // Fetch talent fee split settings
  const settingsRow = await db
    .select({
      talentSharePct: talentSettings.talentSharePct,
      agencySharePct: talentSettings.agencySharePct,
      platformSharePct: talentSettings.platformSharePct,
    })
    .from(talentSettings)
    .where(eq(talentSettings.talentId, talentId))
    .get();

  const talentSharePct = settingsRow?.talentSharePct ?? 65;
  const agencySharePct = settingsRow?.agencySharePct ?? 20;
  const platformSharePct = settingsRow?.platformSharePct ?? 15;

  // Aggregate totals for APPROVED licences
  const [totals, licenceRows] = await Promise.all([
    db
      .select({
        gross: sum(licences.agreedFee),
        platformTotal: sum(licences.platformFee),
        licenceCount: count(licences.id),
      })
      .from(licences)
      .where(and(eq(licences.talentId, talentId), eq(licences.status, "APPROVED")))
      .get(),

    // Full licence history (all statuses for context)
    db
      .select({
        id: licences.id,
        projectName: licences.projectName,
        productionCompany: licences.productionCompany,
        licenceType: licences.licenceType,
        territory: licences.territory,
        status: licences.status,
        agreedFee: licences.agreedFee,
        platformFee: licences.platformFee,
        proposedFee: licences.proposedFee,
        validFrom: licences.validFrom,
        validTo: licences.validTo,
        approvedAt: licences.approvedAt,
        downloadCount: licences.downloadCount,
        licenseeEmail: users.email,
      })
      .from(licences)
      .innerJoin(users, eq(users.id, licences.licenseeId))
      .where(eq(licences.talentId, talentId))
      .orderBy(licences.createdAt)
      .all(),
  ]);

  const grossPence = Number(totals?.gross ?? 0);
  // Derive splits from configurable percentages (platform fee stored in DB but override with settings)
  const agencyPence = Math.round(grossPence * (agencySharePct / 100));
  const platformPence = Math.round(grossPence * (platformSharePct / 100));
  const talentPence = grossPence - agencyPence - platformPence;

  return NextResponse.json({
    summary: {
      grossPence,
      talentPence,
      agencyPence,
      platformPence,
      licenceCount: totals?.licenceCount ?? 0,
      talentSharePct,
      agencySharePct,
      platformSharePct,
    },
    licences: licenceRows,
  });
}
