import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isOrgType, type OrgType } from "@/lib/organisations/orgTypes";
import { resolveCompanyOrg } from "@/lib/organisations/resolveCompany";
import { mintOrgCode } from "@/lib/codes/codes";
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

// POST /api/admin/organisations — admin creates an organisation directly.
// The org starts member-less; ownership is granted later via invites (mirrors
// the concierge flow). Production-company / studio types are unified with the
// production_companies catalogue via resolveCompanyOrg so the two never drift.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  let orgType: OrgType = "production_company";
  if (body.orgType !== undefined) {
    if (!isOrgType(body.orgType)) {
      return NextResponse.json({ error: "Invalid orgType" }, { status: 400 });
    }
    orgType = body.orgType;
  }

  const website = typeof body.website === "string" && body.website.trim() ? body.website.trim() : null;
  const billingEmail = typeof body.billingEmail === "string" && body.billingEmail.trim() ? body.billingEmail.trim() : null;

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Production companies / studios are the same entity as the production_companies
  // catalogue — route them through the unifier so a linked shim always exists.
  if (orgType === "production_company" || orgType === "studio") {
    const { organisationId } = await resolveCompanyOrg(db, { name, createdBy: session.sub, orgType });
    if (website || billingEmail) {
      await db
        .update(organisations)
        .set({ website, billingEmail, updatedAt: now })
        .where(eq(organisations.id, organisationId));
    }
    return NextResponse.json({ id: organisationId }, { status: 201 });
  }

  const orgId = crypto.randomUUID();
  await db.insert(organisations).values({
    id: orgId,
    name,
    website,
    billingEmail,
    orgType,
    createdBy: session.sub,
    createdAt: now,
    updatedAt: now,
  });
  await mintOrgCode(db, orgId, orgType);

  return NextResponse.json({ id: orgId }, { status: 201 });
}
