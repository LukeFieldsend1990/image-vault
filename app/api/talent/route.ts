export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, scanPackages, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, sql, and, isNull } from "drizzle-orm";

// GET /api/talent — list talent with at least one ready package (licensees only)
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "licensee" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

  const talent = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: talentProfiles.fullName,
      profileImageUrl: talentProfiles.profileImageUrl,
      packageCount: sql<number>`count(${scanPackages.id})`.as("package_count"),
    })
    .from(users)
    .leftJoin(talentProfiles, eq(talentProfiles.userId, users.id))
    .leftJoin(
      scanPackages,
      and(eq(scanPackages.talentId, users.id), eq(scanPackages.status, "ready"), isNull(scanPackages.deletedAt))
    )
    .where(eq(users.role, "talent"))
    .groupBy(users.id)
    .all();

  return NextResponse.json({ talent });
}
