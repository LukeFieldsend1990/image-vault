export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps, users, scanPackages, talentProfiles, licences } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and, count, sum, inArray, isNull } from "drizzle-orm";

/** GET /api/roster — returns the list of talent the authed rep manages */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "rep" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

  const rows = await db
    .select({
      talentId: talentReps.talentId,
      email: users.email,
      linkedSince: talentReps.createdAt,
      packageCount: count(scanPackages.id),
      totalSizeBytes: sum(scanPackages.totalSizeBytes),
      fullName: talentProfiles.fullName,
      profileImageUrl: talentProfiles.profileImageUrl,
      tmdbId: talentProfiles.tmdbId,
    })
    .from(talentReps)
    .innerJoin(users, eq(users.id, talentReps.talentId))
    .leftJoin(
      scanPackages,
      and(eq(scanPackages.talentId, talentReps.talentId), eq(scanPackages.status, "ready"), isNull(scanPackages.deletedAt))
    )
    .leftJoin(talentProfiles, eq(talentProfiles.userId, talentReps.talentId))
    .where(eq(talentReps.repId, session.sub))
    .groupBy(
      talentReps.talentId,
      users.email,
      talentReps.createdAt,
      talentProfiles.fullName,
      talentProfiles.profileImageUrl,
      talentProfiles.tmdbId,
    )
    .all();

  // Enrich with per-talent pending licence counts
  const talentIds = rows.map((r) => r.talentId);
  let pendingMap: Record<string, number> = {};
  if (talentIds.length > 0) {
    const pendingRows = await db
      .select({ talentId: licences.talentId, pendingCount: count(licences.id) })
      .from(licences)
      .where(and(inArray(licences.talentId, talentIds), eq(licences.status, "PENDING")))
      .groupBy(licences.talentId)
      .all();
    pendingMap = Object.fromEntries(pendingRows.map((p) => [p.talentId, p.pendingCount]));
  }

  const roster = rows.map((r) => ({ ...r, pendingLicences: pendingMap[r.talentId] ?? 0 }));
  return NextResponse.json({ roster });
}
