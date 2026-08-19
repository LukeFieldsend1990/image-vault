import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, likenessMonitors } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq } from "drizzle-orm";
import { MONITOR_PLANS, getTalentMeter, isMonitorPlanId } from "@/lib/monitor/metering";
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
 * GET /api/admin/talent/[talentId]/monitor-plan
 * The talent's meter (plan, allowance, this period's spend) plus the plan
 * catalogue, so the admin UI can render the picker without a second request.
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

  return NextResponse.json({
    meter: await getTalentMeter(db, talentId),
    plans: MONITOR_PLANS,
  });
}

/**
 * PUT /api/admin/talent/[talentId]/monitor-plan
 * Body: { plan?: string, monthlyBudgetUsd?: number | null } — null clears the
 * override so the plan default applies again. Either field alone is fine.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string }> }
) {
  const g = await guard(req);
  if (g.error) return g.error;

  const { talentId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    plan?: string;
    monthlyBudgetUsd?: number | null;
  };

  const updates: Partial<{ plan: "internal" | "watch" | "guard" | "shield"; monthlyBudgetUsd: number | null }> = {};

  if (body.plan !== undefined) {
    if (!isMonitorPlanId(body.plan)) {
      return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
    }
    updates.plan = body.plan;
  }

  if (body.monthlyBudgetUsd !== undefined) {
    if (body.monthlyBudgetUsd === null) {
      updates.monthlyBudgetUsd = null;
    } else {
      const n = Number(body.monthlyBudgetUsd);
      // Same bounds as the global ceiling — an override past the whole
      // account's plausible spend is a typo, not a plan.
      if (!Number.isFinite(n) || n < 0 || n > 1000) {
        return NextResponse.json({ error: "Allowance must be between $0 and $1000" }, { status: 400 });
      }
      updates.monthlyBudgetUsd = n;
    }
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const db = getDb();
  const talent = await db.select({ id: users.id }).from(users).where(eq(users.id, talentId)).get();
  if (!talent) return NextResponse.json({ error: "Talent not found" }, { status: 404 });

  // The plan lives on the monitor row; create it if this talent has never
  // scanned — the allowance should hold from their very first sweep.
  const monitor = await ensureMonitor(db, talentId);
  await db
    .update(likenessMonitors)
    .set({ ...updates, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(likenessMonitors.id, monitor.id));

  return NextResponse.json({ ok: true, meter: await getTalentMeter(db, talentId) });
}
