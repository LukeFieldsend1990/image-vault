export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCompanies, organisationMembers, licences } from "@/lib/db/schema";
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

  // Batch-fetch licence counts
  const ids = productionRows.map((p) => p.id);
  const licenceCounts =
    ids.length > 0
      ? await db
          .select({ productionId: licences.productionId, count: count() })
          .from(licences)
          .where(inArray(licences.productionId, ids))
          .groupBy(licences.productionId)
          .all()
      : [];

  const countMap = new Map(licenceCounts.map((r) => [r.productionId, r.count]));

  const result = productionRows.map((p) => ({
    ...p,
    licenceCount: countMap.get(p.id) ?? 0,
  }));

  return NextResponse.json({ productions: result });
}
