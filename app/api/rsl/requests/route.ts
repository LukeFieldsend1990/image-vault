import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { rslLicenseRequests, users, talentProfiles } from "@/lib/db/schema";

/**
 * Incoming OLP licence requests, for the rights-holder (or their agent / an
 * admin) to review. Admins see all; talent see their own; reps see managed
 * talent's.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const admin = isAdmin(session.email);
  const requestedTalent = req.nextUrl.searchParams.get("talentId");

  let talentFilter: string | null = null;
  if (!admin) {
    const target = requestedTalent && requestedTalent.trim() ? requestedTalent.trim() : session.sub;
    if (target !== session.sub) {
      if (!(session.role === "rep" && (await hasRepAccess(session.sub, target)))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    talentFilter = target;
  } else if (requestedTalent && requestedTalent.trim()) {
    talentFilter = requestedTalent.trim();
  }

  const rows = await db
    .select({
      id: rslLicenseRequests.id,
      talentId: rslLicenseRequests.talentId,
      email: users.email,
      fullName: talentProfiles.fullName,
      usage: rslLicenseRequests.usage,
      useCategoryId: rslLicenseRequests.useCategoryId,
      postureLight: rslLicenseRequests.postureLight,
      clientName: rslLicenseRequests.clientName,
      clientId: rslLicenseRequests.clientId,
      contactEmail: rslLicenseRequests.contactEmail,
      intendedUse: rslLicenseRequests.intendedUse,
      status: rslLicenseRequests.status,
      createdAt: rslLicenseRequests.createdAt,
      decidedAt: rslLicenseRequests.decidedAt,
    })
    .from(rslLicenseRequests)
    .innerJoin(users, eq(users.id, rslLicenseRequests.talentId))
    .leftJoin(talentProfiles, eq(talentProfiles.userId, rslLicenseRequests.talentId))
    .where(talentFilter ? eq(rslLicenseRequests.talentId, talentFilter) : undefined)
    .orderBy(desc(rslLicenseRequests.createdAt))
    .limit(200)
    .all();

  // Pending first.
  const order: Record<string, number> = { pending_review: 0, granted: 1, denied: 2, expired: 3 };
  rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  return NextResponse.json({ items: rows });
}
