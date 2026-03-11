export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, talentSettings, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

/**
 * GET /api/admin/talent/[talentId]/settings
 * Returns the talent's settings row (or defaults) plus their email and fullName.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { talentId } = await params;
  const db = getDb();

  const [talent, profile, settings] = await Promise.all([
    db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, talentId)).get(),
    db.select({ fullName: talentProfiles.fullName }).from(talentProfiles).where(eq(talentProfiles.userId, talentId)).get(),
    db.select().from(talentSettings).where(eq(talentSettings.talentId, talentId)).get(),
  ]);

  if (!talent) return NextResponse.json({ error: "Talent not found" }, { status: 404 });

  return NextResponse.json({
    talentId,
    email: talent.email,
    fullName: profile?.fullName ?? null,
    pipelineEnabled: settings?.pipelineEnabled ?? true,
    talentSharePct: settings?.talentSharePct ?? 65,
    agencySharePct: settings?.agencySharePct ?? 20,
    platformSharePct: settings?.platformSharePct ?? 15,
  });
}

/**
 * PUT /api/admin/talent/[talentId]/settings
 * Body: { pipelineEnabled?, talentSharePct?, agencySharePct?, platformSharePct? }
 * Upserts the settings row.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { talentId } = await params;
  const body = await req.json() as {
    pipelineEnabled?: boolean;
    talentSharePct?: number;
    agencySharePct?: number;
    platformSharePct?: number;
  };

  // If all three percentages are provided, validate they sum to 100
  const { pipelineEnabled, talentSharePct, agencySharePct, platformSharePct } = body;
  const hasAllPcts = talentSharePct !== undefined && agencySharePct !== undefined && platformSharePct !== undefined;
  const hasAnyPct = talentSharePct !== undefined || agencySharePct !== undefined || platformSharePct !== undefined;

  if (hasAnyPct && !hasAllPcts) {
    return NextResponse.json({ error: "All three percentages must be provided together" }, { status: 400 });
  }
  if (hasAllPcts) {
    if (!Number.isInteger(talentSharePct) || !Number.isInteger(agencySharePct) || !Number.isInteger(platformSharePct)) {
      return NextResponse.json({ error: "Percentages must be integers" }, { status: 400 });
    }
    if (talentSharePct! + agencySharePct! + platformSharePct! !== 100) {
      return NextResponse.json({ error: "Percentages must sum to 100" }, { status: 400 });
    }
    if ([talentSharePct, agencySharePct, platformSharePct].some((n) => n! < 0 || n! > 100)) {
      return NextResponse.json({ error: "Percentages must be between 0 and 100" }, { status: 400 });
    }
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const existing = await db
    .select({ talentId: talentSettings.talentId })
    .from(talentSettings)
    .where(eq(talentSettings.talentId, talentId))
    .get();

  if (existing) {
    const updates: Partial<typeof talentSettings.$inferInsert> = {
      updatedBy: session.sub,
      updatedAt: now,
    };
    if (pipelineEnabled !== undefined) updates.pipelineEnabled = pipelineEnabled;
    if (hasAllPcts) {
      updates.talentSharePct = talentSharePct;
      updates.agencySharePct = agencySharePct;
      updates.platformSharePct = platformSharePct;
    }
    await db.update(talentSettings).set(updates).where(eq(talentSettings.talentId, talentId));
  } else {
    await db.insert(talentSettings).values({
      talentId,
      pipelineEnabled: pipelineEnabled ?? true,
      talentSharePct: talentSharePct ?? 65,
      agencySharePct: agencySharePct ?? 20,
      platformSharePct: platformSharePct ?? 15,
      updatedBy: session.sub,
      updatedAt: now,
    });
  }

  return NextResponse.json({ ok: true });
}
