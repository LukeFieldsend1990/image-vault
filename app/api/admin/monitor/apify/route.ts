import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { aiSettings, apifyUsage } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import {
  APIFY_CEILING_KEY,
  APIFY_ENABLED_KEY,
  APIFY_SINCE_KEY,
  getApifyBudget,
} from "@/lib/monitor/ingest/budget";
import { desc, eq, sql } from "drizzle-orm";

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

async function upsert(db: ReturnType<typeof getDb>, key: string, value: string, userId: string) {
  const now = Math.floor(Date.now() / 1000);
  const existing = await db.select({ key: aiSettings.key }).from(aiSettings).where(eq(aiSettings.key, key)).get();
  if (existing) {
    await db.update(aiSettings).set({ value, updatedBy: userId, updatedAt: now }).where(eq(aiSettings.key, key));
  } else {
    await db.insert(aiSettings).values({ key, value, updatedBy: userId, updatedAt: now });
  }
}

// GET /api/admin/monitor/apify — spend against the ceiling, plus recent runs.
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const db = getDb();
  const budget = await getApifyBudget(db);

  const [runs, byTalent] = await Promise.all([
    db.select().from(apifyUsage).orderBy(desc(apifyUsage.createdAt)).limit(50).all(),
    db
      .select({
        talentId: apifyUsage.talentId,
        cost: sql<number>`coalesce(sum(cost_usd), 0)`,
        runs: sql<number>`count(*)`,
      })
      .from(apifyUsage)
      .where(sql`created_at >= ${budget.since}`)
      .groupBy(apifyUsage.talentId)
      .orderBy(sql`sum(cost_usd) desc`)
      .limit(10)
      .all(),
  ]);

  return NextResponse.json({ budget, runs, byTalent });
}

// PATCH /api/admin/monitor/apify — { ceilingUsd?: number, enabled?: boolean }
export async function PATCH(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const session = g.session!;

  const body = (await req.json().catch(() => ({}))) as { ceilingUsd?: number; enabled?: boolean };
  const db = getDb();

  if (body.ceilingUsd !== undefined) {
    const n = Number(body.ceilingUsd);
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      return NextResponse.json({ error: "Ceiling must be between $0 and $1000" }, { status: 400 });
    }
    await upsert(db, APIFY_CEILING_KEY, n.toFixed(2), session.sub);
  }

  if (body.enabled !== undefined) {
    await upsert(db, APIFY_ENABLED_KEY, body.enabled ? "true" : "false", session.sub);
  }

  return NextResponse.json({ budget: await getApifyBudget(db) });
}

// POST /api/admin/monitor/apify — reset the spend counter to now.
// The ledger is kept; only the window moves, so history stays auditable.
export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const session = g.session!;

  const db = getDb();
  await upsert(db, APIFY_SINCE_KEY, String(Math.floor(Date.now() / 1000)), session.sub);
  return NextResponse.json({ budget: await getApifyBudget(db) });
}
