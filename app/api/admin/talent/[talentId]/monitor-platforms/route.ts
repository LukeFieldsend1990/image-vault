import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, likenessMonitors } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq } from "drizzle-orm";
import { MONITOR_PLATFORMS, isMonitorPlatformId } from "@/lib/monitor/platforms";
import {
  applyPlatformOverrides,
  getEnabledPlatforms,
  parsePlatformOverrides,
} from "@/lib/monitor/platform-settings";
import { ensureMonitor } from "@/lib/monitor/scan";

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

/**
 * GET /api/admin/talent/[talentId]/monitor-platforms
 * Per-platform coverage for one talent: global toggle, this talent's override
 * (true/false, or null for inherit), and the effective result.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string }> }
) {
  const g = await guard(req);
  if (g.error) return g.error;

  const { talentId } = await params;
  const db = getDb();

  const talent = await db.select({ id: users.id }).from(users).where(eq(users.id, talentId)).get();
  if (!talent) return NextResponse.json({ error: "Talent not found" }, { status: 404 });

  const [global, monitor] = await Promise.all([
    getEnabledPlatforms(db),
    db
      .select({ platformOverridesJson: likenessMonitors.platformOverridesJson })
      .from(likenessMonitors)
      .where(eq(likenessMonitors.talentId, talentId))
      .get(),
  ]);
  const overrides = parsePlatformOverrides(monitor?.platformOverridesJson);
  const effective = applyPlatformOverrides(global, overrides);

  return NextResponse.json({
    platforms: MONITOR_PLATFORMS.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      globalEnabled: global.has(p.id),
      override: overrides[p.id] ?? null,
      effective: effective.has(p.id),
    })),
  });
}

/**
 * PUT /api/admin/talent/[talentId]/monitor-platforms
 * Body: { platformId, override: true | false | null } — null clears the
 * override so the platform inherits the global toggle again.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string }> }
) {
  const g = await guard(req);
  if (g.error) return g.error;

  const { talentId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    platformId?: string;
    override?: boolean | null;
  };
  if (typeof body.platformId !== "string" || !isMonitorPlatformId(body.platformId)) {
    return NextResponse.json({ error: "Unknown platformId" }, { status: 400 });
  }
  if (body.override !== true && body.override !== false && body.override !== null) {
    return NextResponse.json({ error: "override must be true, false or null" }, { status: 400 });
  }

  const db = getDb();
  const talent = await db.select({ id: users.id }).from(users).where(eq(users.id, talentId)).get();
  if (!talent) return NextResponse.json({ error: "Talent not found" }, { status: 404 });

  // Overrides live on the monitor row; create it if this talent has never
  // scanned — the override should hold from their very first sweep.
  const monitor = await ensureMonitor(db, talentId);
  const overrides = parsePlatformOverrides(monitor.platformOverridesJson);
  if (body.override === null) delete overrides[body.platformId];
  else overrides[body.platformId] = body.override;

  await db
    .update(likenessMonitors)
    .set({
      platformOverridesJson: JSON.stringify(overrides),
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(likenessMonitors.id, monitor.id));

  return NextResponse.json({ ok: true });
}
