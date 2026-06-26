import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionDefaultTerms, organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { CAST_LICENCE_TYPES, CAST_EXCLUSIVITIES, serializeLicenceTypes } from "@/lib/productions/cast";
import { reconcileTrainingFlag, serializeUseCategoryIds } from "@/lib/consent/use-categories";
import { eq, and } from "drizzle-orm";

// Auth helper: admin, or industry org owner/admin on the production's org.
async function authorise(
  db: ReturnType<typeof getDb>,
  session: { sub: string; email: string; role: string },
  organisationId: string | null,
  requireWrite: boolean,
): Promise<NextResponse | null> {
  if (isAdmin(session.email)) return null;
  if (!isIndustryRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!organisationId) return null;
  const membership = await db
    .select({ memberRole: organisationMembers.memberRole })
    .from(organisationMembers)
    .where(and(
      eq(organisationMembers.organisationId, organisationId),
      eq(organisationMembers.userId, session.sub),
    ))
    .get();
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (requireWrite && membership.memberRole !== "owner" && membership.memberRole !== "admin") {
    return NextResponse.json({ error: "Forbidden — org owner or admin required" }, { status: 403 });
  }
  return null;
}

// GET /api/productions/[id]/default-terms — current production-level default terms (or null).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const production = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  const forbidden = await authorise(db, session, production.organisationId, false);
  if (forbidden) return forbidden;

  const terms = await db
    .select()
    .from(productionDefaultTerms)
    .where(eq(productionDefaultTerms.productionId, id))
    .get();

  return NextResponse.json({ terms: terms ?? null });
}

// PUT /api/productions/[id]/default-terms — upsert production-level default terms.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const production = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  const forbidden = await authorise(db, session, production.organisationId, true);
  if (forbidden) return forbidden;

  let body: {
    intendedUse?: unknown;
    licenceType?: unknown;
    licenceTypes?: unknown;
    territory?: unknown;
    exclusivity?: unknown;
    permitAiTraining?: unknown;
    useCategoryIds?: unknown;
    validFrom?: unknown;
    validTo?: unknown;
    proposedFee?: unknown;
    isRelicense?: unknown;
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const intendedUse = typeof body.intendedUse === "string" && body.intendedUse.trim() ? body.intendedUse.trim() : null;
  // Multi-select use types (item 7); legacy single licenceType = primary (first).
  const licenceTypesJson = serializeLicenceTypes(body.licenceTypes);
  const licenceTypesArr = licenceTypesJson ? (JSON.parse(licenceTypesJson) as string[]) : [];
  const licenceType = licenceTypesArr[0]
    ?? (typeof body.licenceType === "string" && (CAST_LICENCE_TYPES as readonly string[]).includes(body.licenceType) ? body.licenceType : null);
  const isRelicense = typeof body.isRelicense === "boolean" ? body.isRelicense : null;
  const territory = typeof body.territory === "string" && body.territory.trim() ? body.territory.trim() : null;
  const exclusivity = typeof body.exclusivity === "string" && (CAST_EXCLUSIVITIES as readonly string[]).includes(body.exclusivity) ? body.exclusivity : null;
  // Reconcile the use-category taxonomy with the legacy permitAiTraining boolean
  // so selecting `training` (§39G) and the flag can't drift apart.
  const reconciled = reconcileTrainingFlag({
    useCategoryIds: Array.isArray(body.useCategoryIds) ? (body.useCategoryIds as unknown[]).filter((v): v is string => typeof v === "string") : null,
    permitAiTraining: body.permitAiTraining === true,
  });
  const permitAiTraining = reconciled.permitAiTraining;
  const useCategoriesJson = serializeUseCategoryIds(reconciled.useCategoryIds);
  const validFrom = typeof body.validFrom === "number" ? Math.floor(body.validFrom) : null;
  const validTo = typeof body.validTo === "number" ? Math.floor(body.validTo) : null;
  const proposedFee = typeof body.proposedFee === "number" ? Math.floor(body.proposedFee) : null;

  if (validFrom !== null && validTo !== null && validTo <= validFrom) {
    return NextResponse.json({ error: "validTo must be after validFrom" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(productionDefaultTerms)
    .values({
      productionId: id,
      intendedUse,
      licenceType,
      licenceTypesJson,
      isRelicense,
      territory,
      exclusivity,
      permitAiTraining,
      useCategoriesJson,
      validFrom,
      validTo,
      proposedFee,
      updatedBy: session.sub,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: productionDefaultTerms.productionId,
      set: { intendedUse, licenceType, licenceTypesJson, isRelicense, territory, exclusivity, permitAiTraining, useCategoriesJson, validFrom, validTo, proposedFee, updatedBy: session.sub, updatedAt: now },
    });

  return NextResponse.json({ ok: true });
}
