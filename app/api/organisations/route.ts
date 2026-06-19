import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, productionCompanies } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isIndustryRole } from "@/lib/auth/roles";
import { isOrgType, type OrgType } from "@/lib/organisations/orgTypes";
import { mintOrgCode } from "@/lib/codes/codes";
import { eq } from "drizzle-orm";

// GET /api/organisations — list orgs the calling user belongs to
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const rows = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      website: organisations.website,
      billingEmail: organisations.billingEmail,
      orgType: organisations.orgType,
      shortCode: organisations.shortCode,
      createdAt: organisations.createdAt,
      memberRole: organisationMembers.memberRole,
      joinedAt: organisationMembers.joinedAt,
    })
    .from(organisationMembers)
    .innerJoin(organisations, eq(organisations.id, organisationMembers.organisationId))
    .where(eq(organisationMembers.userId, session.sub))
    .all();

  return NextResponse.json({ organisations: rows });
}

// POST /api/organisations — create a new org (licensee only)
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (!isIndustryRole(session.role) && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    name?: string;
    website?: string;
    billingEmail?: string;
    productionCompanyId?: string;
    orgType?: string;
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  let orgType: OrgType = "production_company";
  if (body.orgType !== undefined) {
    if (!isOrgType(body.orgType)) {
      return NextResponse.json({ error: "invalid orgType" }, { status: 400 });
    }
    orgType = body.orgType;
  }

  if (body.productionCompanyId) {
    const db = getDb();
    const [pc] = await db
      .select({ id: productionCompanies.id })
      .from(productionCompanies)
      .where(eq(productionCompanies.id, body.productionCompanyId))
      .limit(1)
      .all();
    if (!pc) {
      return NextResponse.json({ error: "productionCompanyId not found" }, { status: 400 });
    }
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const orgId = crypto.randomUUID();

  await db.insert(organisations).values({
    id: orgId,
    name: body.name.trim(),
    website: body.website?.trim() ?? null,
    billingEmail: body.billingEmail?.trim() ?? null,
    productionCompanyId: body.productionCompanyId ?? null,
    orgType,
    createdBy: session.sub,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(organisationMembers).values({
    organisationId: orgId,
    userId: session.sub,
    memberRole: "owner",
    invitedBy: null,
    joinedAt: now,
  });

  await mintOrgCode(db, orgId, orgType);

  return NextResponse.json({ organisationId: orgId }, { status: 201 });
}
