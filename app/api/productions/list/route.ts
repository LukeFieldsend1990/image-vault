export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCompanies, organisationMembers, licences, productionCast } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, inArray, count, desc } from "drizzle-orm";

// GET /api/productions/list — productions scoped to the caller's organisations
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  let productionRows;

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
        organisationId: productions.organisationId,
        createdAt: productions.createdAt,
      })
      .from(productions)
      .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
      .orderBy(desc(productions.createdAt))
      .limit(100)
      .all();
  } else if (session.role === "licensee") {
    const memberRows = await db
      .select({ organisationId: organisationMembers.organisationId })
      .from(organisationMembers)
      .where(eq(organisationMembers.userId, session.sub))
      .all();

    const orgIds = memberRows.map((r) => r.organisationId);
    if (orgIds.length === 0) {
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
        organisationId: productions.organisationId,
        createdAt: productions.createdAt,
      })
      .from(productions)
      .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
      .where(inArray(productions.organisationId, orgIds))
      .orderBy(desc(productions.createdAt))
      .limit(100)
      .all();
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ids = productionRows.map((p) => p.id);

  const [licenceCounts, castRows] = await Promise.all([
    ids.length > 0
      ? db.select({ productionId: licences.productionId, count: count() })
          .from(licences).where(inArray(licences.productionId, ids)).groupBy(licences.productionId).all()
      : Promise.resolve([]),
    ids.length > 0
      ? db.select({ productionId: productionCast.productionId, status: productionCast.status })
          .from(productionCast).where(inArray(productionCast.productionId, ids)).all()
      : Promise.resolve([]),
  ]);

  const countMap = new Map(licenceCounts.map((r) => [r.productionId, r.count]));

  const castMap = new Map<string, { total: number; consented: number; invited: number; linked: number }>();
  for (const c of castRows) {
    const cur = castMap.get(c.productionId) ?? { total: 0, consented: 0, invited: 0, linked: 0 };
    cur.total++;
    if (c.status === "consented") cur.consented++;
    else if (c.status === "invited") cur.invited++;
    else cur.linked++;
    castMap.set(c.productionId, cur);
  }

  const result = productionRows.map((p) => ({
    ...p,
    licenceCount: countMap.get(p.id) ?? 0,
    cast: castMap.get(p.id) ?? null,
  }));

  return NextResponse.json({ productions: result });
}
