export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps, talentLicencePermissions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

const LICENCE_TYPES = [
  "commercial",
  "film_double",
  "game_character",
  "ai_avatar",
  "training_data",
  "monitoring_reference",
] as const;

type LicenceType = (typeof LICENCE_TYPES)[number];
type Permission = "allowed" | "approval_required" | "blocked";

const DEFAULTS: Record<LicenceType, Permission> = {
  commercial: "approval_required",
  film_double: "approval_required",
  game_character: "approval_required",
  ai_avatar: "approval_required",
  training_data: "blocked",
  monitoring_reference: "allowed",
};

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
 * Returns permission setting for all 6 licence types for the given talent.
 * If a row doesn't exist for a type yet, returns the default value.
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
  const rows = await db
    .select({ licenceType: talentLicencePermissions.licenceType, permission: talentLicencePermissions.permission })
    .from(talentLicencePermissions)
    .where(eq(talentLicencePermissions.talentId, talentId))
    .all();

  const map = Object.fromEntries(rows.map((r) => [r.licenceType, r.permission])) as Record<string, Permission>;

  const permissions = LICENCE_TYPES.map((type) => ({
    licenceType: type,
    permission: (map[type] as Permission | undefined) ?? DEFAULTS[type],
  }));

  return NextResponse.json({ permissions });
}

/**
 * PUT /api/roster/[talentId]/permissions
 * Body: { licenceType: string, permission: "allowed"|"approval_required"|"blocked" }
 * Upserts a single permission row.
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

  if (!LICENCE_TYPES.includes(licenceType as LicenceType)) {
    return NextResponse.json({ error: "Invalid licenceType" }, { status: 400 });
  }
  if (!["allowed", "approval_required", "blocked"].includes(permission as string)) {
    return NextResponse.json({ error: "Invalid permission" }, { status: 400 });
  }

  const db = getDb();
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
      .set({ permission: permission as Permission, updatedBy: session.sub, updatedAt: now })
      .where(eq(talentLicencePermissions.id, existing.id));
  } else {
    await db.insert(talentLicencePermissions).values({
      id: crypto.randomUUID(),
      talentId,
      licenceType: licenceType as LicenceType,
      permission: permission as Permission,
      updatedBy: session.sub,
      updatedAt: now,
    });
  }

  return NextResponse.json({ ok: true });
}
