import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCast } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and, sql } from "drizzle-orm";

// GET /api/cast/rep-assignments
// Reserved cast slots assigned to the signed-in rep (Path C), still unresolved.
// Drives the rep-side "reserved roles for your clients" surface on the roster.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "rep") {
    return NextResponse.json({ assignments: [] });
  }

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
      actorName: productionCast.actorName,
      characterName: productionCast.characterName,
      productionName: productions.name,
      companyName: companyNameSql,
    })
    .from(productionCast)
    .innerJoin(productions, eq(productions.id, productionCast.productionId))
    .where(and(
      eq(productionCast.repId, session.sub),
      eq(productionCast.status, "placeholder"),
    ))
    .all();

  return NextResponse.json({ assignments: rows });
}
