import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps, talentLicencePermissions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";
import {
  isLicenceType,
  isLicencePermission,
  resolveLicencePermissions,
  permissionToDisposition,
  LICENCE_TYPE_USE_CATEGORY,
  type LicenceType,
  type LicencePermission,
} from "@/lib/consent/licence-permissions";
import { loadStandingInstructions, setStandingInstructions } from "@/lib/consent/standing-instructions";

async function assertRepAccess(repId: string, talentId: string) {
  const db = getDb();
  const link = await db
    .select({ id: talentReps.id })
    .from(talentReps)
    .where(and(eq(talentReps.repId, repId), eq(talentReps.talentId, talentId)))
    .get();
  return !!link;
}

/**
 * GET /api/roster/[talentId]/permissions
 * Returns the effective permission for all 6 licence types for the given
 * talent. Consent-owned types (training_data ↔ §39G) are derived from the
 * talent's standing instructions; the rest fall back to stored rows/defaults.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { talentId } = await params;

  // Rep: must manage this talent. Talent: must be themselves.
  if (session.role === "rep") {
    const ok = await assertRepAccess(session.sub, talentId);
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (session.role === "talent") {
    if (session.sub !== talentId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const [rows, instructions] = await Promise.all([
    db
      .select({ licenceType: talentLicencePermissions.licenceType, permission: talentLicencePermissions.permission })
      .from(talentLicencePermissions)
      .where(eq(talentLicencePermissions.talentId, talentId))
      .all(),
    loadStandingInstructions(db, talentId),
  ]);

  return NextResponse.json({ permissions: resolveLicencePermissions(rows, instructions) });
}

/**
 * PUT /api/roster/[talentId]/permissions
 * Body: { licenceType: string, permission: "allowed"|"approval_required"|"blocked" }
 * Upserts a single permission. Consent-owned licence types write the mapped
 * disposition to the standing instruction instead of a permission row, so the
 * consent model stays the single source of truth.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { talentId } = await params;

  if (session.role === "rep") {
    const ok = await assertRepAccess(session.sub, talentId);
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (session.role === "talent") {
    if (session.sub !== talentId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as { licenceType?: string; permission?: string };
  const { licenceType, permission } = body;

  if (!isLicenceType(licenceType)) {
    return NextResponse.json({ error: "Invalid licenceType" }, { status: 400 });
  }
  if (!isLicencePermission(permission)) {
    return NextResponse.json({ error: "Invalid permission" }, { status: 400 });
  }

  const db = getDb();

  const useCategoryId = LICENCE_TYPE_USE_CATEGORY[licenceType];
  if (useCategoryId) {
    await setStandingInstructions(db, talentId, session.sub, {
      [useCategoryId]: permissionToDisposition(permission),
    });
    return NextResponse.json({ ok: true });
  }

  const now = Math.floor(Date.now() / 1000);

  // Check if row exists
  const existing = await db
    .select({ id: talentLicencePermissions.id })
    .from(talentLicencePermissions)
    .where(
      and(
        eq(talentLicencePermissions.talentId, talentId),
        eq(talentLicencePermissions.licenceType, licenceType as LicenceType),
      ),
    )
    .get();

  if (existing) {
    await db
      .update(talentLicencePermissions)
      .set({ permission: permission as LicencePermission, updatedBy: session.sub, updatedAt: now })
      .where(eq(talentLicencePermissions.id, existing.id));
  } else {
    await db.insert(talentLicencePermissions).values({
      id: crypto.randomUUID(),
      talentId,
      licenceType: licenceType as LicenceType,
      permission: permission as LicencePermission,
      updatedBy: session.sub,
      updatedAt: now,
    });
  }

  return NextResponse.json({ ok: true });
}
