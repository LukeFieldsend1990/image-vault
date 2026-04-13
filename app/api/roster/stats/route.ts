export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps, scanPackages, licences, downloadEvents } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and, inArray, gte, lt, count, sum, sql, isNull } from "drizzle-orm";

/**
 * GET /api/roster/stats
 * Returns aggregated metrics across all talent the rep manages.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "rep" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Quarter start: first day of current calendar quarter
  const date = new Date();
  const qMonth = Math.floor(date.getMonth() / 3) * 3; // 0, 3, 6, or 9
  const quarterStart = Math.floor(new Date(date.getFullYear(), qMonth, 1).getTime() / 1000);

  // Get all talent IDs this rep manages
  const talentRows = await db
    .select({ talentId: talentReps.talentId })
    .from(talentReps)
    .where(eq(talentReps.repId, session.sub))
    .all();

  const talentIds = talentRows.map((r) => r.talentId);

  if (talentIds.length === 0) {
    return NextResponse.json({
      totalScans: 0,
      activeLicences: 0,
      revenueThisQuarterPence: 0,
      pendingRequests: 0,
      totalRevenuePence: 0,
    });
  }

  // All these queries run independently — we fire them in parallel
  const [scanResult, activeLicenceResult, quarterRevenueResult, pendingResult, totalRevenueResult] =
    await Promise.all([
      // Total ready scan packages
      db
        .select({ total: count(scanPackages.id) })
        .from(scanPackages)
        .where(and(inArray(scanPackages.talentId, talentIds), eq(scanPackages.status, "ready"), isNull(scanPackages.deletedAt)))
        .get(),

      // Active licences (APPROVED + validTo > now)
      db
        .select({ total: count(licences.id) })
        .from(licences)
        .where(
          and(
            inArray(licences.talentId, talentIds),
            eq(licences.status, "APPROVED"),
            gte(licences.validTo, now),
          ),
        )
        .get(),

      // Revenue this quarter (sum agreedFee for licences approved this quarter)
      db
        .select({ total: sum(licences.agreedFee) })
        .from(licences)
        .where(
          and(
            inArray(licences.talentId, talentIds),
            eq(licences.status, "APPROVED"),
            gte(licences.approvedAt, quarterStart),
          ),
        )
        .get(),

      // Pending licence requests
      db
        .select({ total: count(licences.id) })
        .from(licences)
        .where(and(inArray(licences.talentId, talentIds), eq(licences.status, "PENDING")))
        .get(),

      // Total all-time approved revenue
      db
        .select({ total: sum(licences.agreedFee) })
        .from(licences)
        .where(and(inArray(licences.talentId, talentIds), eq(licences.status, "APPROVED")))
        .get(),
    ]);

  return NextResponse.json({
    totalScans: scanResult?.total ?? 0,
    activeLicences: activeLicenceResult?.total ?? 0,
    revenueThisQuarterPence: Number(quarterRevenueResult?.total ?? 0),
    pendingRequests: pendingResult?.total ?? 0,
    totalRevenuePence: Number(totalRevenueResult?.total ?? 0),
  });
}
