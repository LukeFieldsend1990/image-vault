import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCast } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and, sql } from "drizzle-orm";

// GET /api/productions/rep-placeholders
// Productions where the signed-in rep has a reserved cast slot (Path C) that
// still needs their client's email to be connected. Drives the pending-engagements
// surface on the rep's My Productions page.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "rep") return NextResponse.json({ placeholders: [] });

  const db = getDb();

  const companyNameSql = sql<string>`coalesce(
    (SELECT name FROM organisations WHERE id = ${productions.organisationId}),
    (SELECT name FROM production_companies WHERE id = ${productions.companyId}),
    'a production company'
  )`;

  const rows = await db
    .select({
      castId: productionCast.id,
      productionId: productionCast.productionId,
      productionName: productions.name,
      productionStatus: productions.status,
      productionType: productions.type,
      productionYear: productions.year,
      companyName: companyNameSql,
      actorName: productionCast.actorName,
      characterName: productionCast.characterName,
      addedAt: productionCast.addedAt,
    })
    .from(productionCast)
    .innerJoin(productions, eq(productions.id, productionCast.productionId))
    .where(and(
      eq(productionCast.repId, session.sub),
      eq(productionCast.status, "placeholder"),
    ))
    .orderBy(productionCast.addedAt)
    .all();

  return NextResponse.json({ placeholders: rows });
}
