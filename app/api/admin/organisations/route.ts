import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, desc, count } from "drizzle-orm";

// GET /api/admin/organisations — list all orgs with member counts
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

  const rows = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      website: organisations.website,
      billingEmail: organisations.billingEmail,
      createdAt: organisations.createdAt,
      createdByEmail: users.email,
    })
    .from(organisations)
    .leftJoin(users, eq(users.id, organisations.createdBy))
    .orderBy(desc(organisations.createdAt))
    .all();

  // Fetch member counts separately (D1 SQLite has limited subquery support)
  const memberCounts = await db
    .select({ organisationId: organisationMembers.organisationId, memberCount: count() })
    .from(organisationMembers)
    .groupBy(organisationMembers.organisationId)
    .all();

  const countMap = Object.fromEntries(memberCounts.map(r => [r.organisationId, r.memberCount]));

  return NextResponse.json({
    organisations: rows.map(r => ({ ...r, memberCount: countMap[r.id] ?? 0 })),
  });
}
