import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentProfiles, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { inArray } from "drizzle-orm";
import { MONITOR_PLANS, listTalentMeters } from "@/lib/monitor/metering";

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

/**
 * GET /api/admin/monitor/meters — every monitored talent's plan and current
 * calendar-month discovery spend, enriched with names so the admin panel can
 * render without a lookup per row. Plan changes go through
 * PUT /api/admin/talent/[talentId]/monitor-plan.
 */
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const db = getDb();
  const meters = await listTalentMeters(db);

  const ids = meters.map((m) => m.talentId);
  const [profiles, accounts] = ids.length
    ? await Promise.all([
        db
          .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
          .from(talentProfiles)
          .where(inArray(talentProfiles.userId, ids))
          .all(),
        db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ids)).all(),
      ])
    : [[], []];

  const nameById = new Map(profiles.map((p) => [p.userId, p.fullName]));
  const emailById = new Map(accounts.map((a) => [a.id, a.email]));

  return NextResponse.json({
    meters: meters.map((m) => ({
      ...m,
      name: nameById.get(m.talentId) ?? null,
      email: emailById.get(m.talentId) ?? null,
    })),
    plans: MONITOR_PLANS,
  });
}
