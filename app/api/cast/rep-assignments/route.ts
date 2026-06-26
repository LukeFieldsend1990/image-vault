import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCast, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { loadProductionDefaultTerms, type CastLicenceTerms } from "@/lib/productions/cast";
import { eq, and, sql } from "drizzle-orm";

// GET /api/cast/rep-assignments
// Reserved cast slots assigned to the signed-in rep (Path C), still unresolved.
// Drives the rep-side "reserved roles for your clients" surface on the roster.
// `hasTerms` tells the UI whether the producer has set intended-use + dates yet
// (row-stored or via production defaults); without them the rep cannot connect
// their client, so the UI surfaces a "nudge producer" affordance instead.
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
      licenceTermsJson: productionCast.licenceTermsJson,
      addedBy: productionCast.addedBy,
      productionName: productions.name,
      companyName: companyNameSql,
      coordinatorEmail: users.email,
    })
    .from(productionCast)
    .innerJoin(productions, eq(productions.id, productionCast.productionId))
    .leftJoin(users, eq(users.id, productionCast.addedBy))
    .where(and(
      eq(productionCast.repId, session.sub),
      eq(productionCast.status, "placeholder"),
    ))
    .all();

  const productionDefaults = new Map<string, CastLicenceTerms>();
  const assignments = await Promise.all(
    rows.map(async (r) => {
      let stored: CastLicenceTerms = {};
      if (r.licenceTermsJson) {
        try { stored = JSON.parse(r.licenceTermsJson) as CastLicenceTerms; } catch { stored = {}; }
      }
      if (!productionDefaults.has(r.productionId)) {
        productionDefaults.set(r.productionId, await loadProductionDefaultTerms(db, r.productionId));
      }
      const defaults = productionDefaults.get(r.productionId) ?? {};
      const intendedUse = (stored.intendedUse ?? defaults.intendedUse ?? "").trim();
      const validFrom = stored.validFrom ?? defaults.validFrom;
      const validTo = stored.validTo ?? defaults.validTo;
      const hasTerms = Boolean(intendedUse) && typeof validFrom === "number" && typeof validTo === "number";

      // Resolved view: stored row terms merged over production defaults (stored
      // takes precedence), the same precedence used for hasTerms / promotion.
      const licenceTypes =
        (stored.licenceTypes && stored.licenceTypes.length ? stored.licenceTypes : undefined)
        ?? (defaults.licenceTypes && defaults.licenceTypes.length ? defaults.licenceTypes : undefined)
        ?? null;
      const terms = {
        intendedUse: intendedUse || null,
        licenceType: stored.licenceType ?? defaults.licenceType ?? null,
        licenceTypes,
        validFrom: validFrom ?? null,
        validTo: validTo ?? null,
        territory: stored.territory ?? defaults.territory ?? null,
        exclusivity: stored.exclusivity ?? defaults.exclusivity ?? null,
        proposedFee: stored.proposedFee ?? defaults.proposedFee ?? null,
        isRelicense: stored.isRelicense ?? defaults.isRelicense ?? null,
        permitAiTraining: stored.permitAiTraining ?? defaults.permitAiTraining ?? null,
      };

      return {
        castId: r.castId,
        productionId: r.productionId,
        actorName: r.actorName,
        characterName: r.characterName,
        productionName: r.productionName,
        companyName: r.companyName,
        hasTerms,
        terms,
        coordinatorEmail: r.coordinatorEmail ?? null,
      };
    }),
  );

  return NextResponse.json({ assignments });
}
