import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCompanies, organisations, organisationMembers, licences, productionCast, productionVendors } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { getRepAgencyContext } from "@/lib/agency/rep-visibility";
import { eq, and, or, inArray, count, desc } from "drizzle-orm";

// GET /api/productions/list — productions scoped to the caller's organisations
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  let productionRows;
  // Orgs the caller belongs to — used to tell "owner" productions apart from
  // ones where their org is only an attached vendor.
  let viewerOrgIds: string[] = [];

  if (isAdmin(session.email)) {
    productionRows = await db
      .select({
        id: productions.id,
        name: productions.name,
        companyName: productionCompanies.name,
        type: productions.type,
        year: productions.year,
        status: productions.status,
        sagProjectNumber: productions.sagProjectNumber,
        shortCode: productions.shortCode,
        organisationId: productions.organisationId,
        orgName: organisations.name,
        orgType: organisations.orgType,
        orgShortCode: organisations.shortCode,
        createdAt: productions.createdAt,
      })
      .from(productions)
      .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
      .leftJoin(organisations, eq(organisations.id, productions.organisationId))
      .orderBy(desc(productions.createdAt))
      .limit(100)
      .all();
  } else if (isIndustryRole(session.role)) {
    const memberRows = await db
      .select({ organisationId: organisationMembers.organisationId })
      .from(organisationMembers)
      .where(eq(organisationMembers.userId, session.sub))
      .all();

    const orgIds = memberRows.map((r) => r.organisationId);
    viewerOrgIds = orgIds;
    if (orgIds.length === 0) {
      return NextResponse.json({ productions: [] });
    }

    // Productions where one of the caller's orgs is attached as an active vendor —
    // surfaced read-only alongside the ones they own.
    const vendorLinks = await db
      .select({ productionId: productionVendors.productionId })
      .from(productionVendors)
      .where(and(inArray(productionVendors.vendorOrgId, orgIds), eq(productionVendors.status, "active")))
      .all();
    const vendorProdIds = [...new Set(vendorLinks.map((v) => v.productionId))];

    const whereClause = vendorProdIds.length > 0
      ? or(inArray(productions.organisationId, orgIds), inArray(productions.id, vendorProdIds))
      : inArray(productions.organisationId, orgIds);

    productionRows = await db
      .select({
        id: productions.id,
        name: productions.name,
        companyName: productionCompanies.name,
        type: productions.type,
        year: productions.year,
        status: productions.status,
        sagProjectNumber: productions.sagProjectNumber,
        shortCode: productions.shortCode,
        organisationId: productions.organisationId,
        orgName: organisations.name,
        orgType: organisations.orgType,
        orgShortCode: organisations.shortCode,
        createdAt: productions.createdAt,
      })
      .from(productions)
      .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
      .leftJoin(organisations, eq(organisations.id, productions.organisationId))
      .where(whereClause)
      .orderBy(desc(productions.createdAt))
      .limit(100)
      .all();
  } else if (session.role === "rep") {
    // Agency-shared production visibility: a rep can see productions where any
    // talent managed by a rep in their agency holds an APPROVED licence. Rep is
    // ALSO entitled to productions where they personally hold a reserved cast
    // slot (existing path C invite flow). Rosters stay segregated — this list
    // only spans agency colleagues at the production level.
    const ctx = await getRepAgencyContext(db, session.sub);

    const castSlotRows = await db
      .select({ productionId: productionCast.productionId })
      .from(productionCast)
      .where(eq(productionCast.repId, session.sub))
      .all();
    const castProdIds = [...new Set(castSlotRows.map((r) => r.productionId))];

    const visibleIds = [...new Set([...ctx.agencyProductionIds, ...castProdIds])];
    if (visibleIds.length === 0) {
      return NextResponse.json({ productions: [] });
    }

    productionRows = await db
      .select({
        id: productions.id,
        name: productions.name,
        companyName: productionCompanies.name,
        type: productions.type,
        year: productions.year,
        status: productions.status,
        sagProjectNumber: productions.sagProjectNumber,
        shortCode: productions.shortCode,
        organisationId: productions.organisationId,
        orgName: organisations.name,
        orgType: organisations.orgType,
        orgShortCode: organisations.shortCode,
        createdAt: productions.createdAt,
      })
      .from(productions)
      .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
      .leftJoin(organisations, eq(organisations.id, productions.organisationId))
      .where(inArray(productions.id, visibleIds))
      .orderBy(desc(productions.createdAt))
      .limit(100)
      .all();
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ids = productionRows.map((p) => p.id);

  const [licenceCounts, castGroups] = await Promise.all([
    ids.length > 0
      ? db.select({ productionId: licences.productionId, count: count() })
          .from(licences).where(inArray(licences.productionId, ids)).groupBy(licences.productionId).all()
      : Promise.resolve([]),
    // Aggregate cast counts by (production, status) in SQL rather than pulling
    // every cast row and tallying in JS.
    ids.length > 0
      ? db.select({ productionId: productionCast.productionId, status: productionCast.status, n: count() })
          .from(productionCast).where(inArray(productionCast.productionId, ids))
          .groupBy(productionCast.productionId, productionCast.status).all()
      : Promise.resolve([]),
  ]);

  const countMap = new Map(licenceCounts.map((r) => [r.productionId, r.count]));

  const castMap = new Map<string, { total: number; consented: number; invited: number; linked: number; placeholder: number; resolved: number }>();
  for (const g of castGroups) {
    const cur = castMap.get(g.productionId) ?? { total: 0, consented: 0, invited: 0, linked: 0, placeholder: 0, resolved: 0 };
    cur.total += g.n;
    if (g.status === "consented") cur.consented += g.n;
    else if (g.status === "invited") cur.invited += g.n;
    else if (g.status === "placeholder") cur.placeholder += g.n;
    else cur.linked += g.n;
    // "Resolved" = anything that has progressed past a reserved placeholder.
    if (g.status !== "placeholder") cur.resolved += g.n;
    castMap.set(g.productionId, cur);
  }

  const result = productionRows.map((p) => {
    let relationship: "owner" | "vendor" | "rep";
    if (isAdmin(session.email) || (p.organisationId !== null && viewerOrgIds.includes(p.organisationId))) {
      relationship = "owner";
    } else if (session.role === "rep") {
      // Reps see productions via agency-shared licence visibility — they're
      // neither owner nor vendor; this surfaces as a read-only entry point.
      relationship = "rep";
    } else {
      relationship = "vendor";
    }
    return {
      ...p,
      licenceCount: countMap.get(p.id) ?? 0,
      cast: castMap.get(p.id) ?? null,
      relationship,
    };
  });

  return NextResponse.json({ productions: result });
}
