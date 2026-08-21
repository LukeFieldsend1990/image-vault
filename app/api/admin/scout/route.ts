import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { aiSettings, apifyUsage, trialAllowances, trialScans, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import {
  DEFAULT_TRIAL_RUN_LIMIT,
  listTrialsForAdmin,
  TRIAL_ENABLED_KEY,
  TRIAL_RUN_LIMIT_KEY,
} from "@/lib/monitor/trial";
import { and, eq, inArray, sql } from "drizzle-orm";

/**
 * GET /api/admin/scout — everything the Likeness Scout admin panel shows:
 * the feature toggle and default run limit, the trial ledger with per-trial
 * Apify spend, and the per-user allowance grants.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  const admin = session.role === "admin" || isAdmin(session.email);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();

  const [enabledRow, limitRow, trials, allowanceRows] = await Promise.all([
    db.select({ value: aiSettings.value }).from(aiSettings).where(eq(aiSettings.key, TRIAL_ENABLED_KEY)).get(),
    db.select({ value: aiSettings.value }).from(aiSettings).where(eq(aiSettings.key, TRIAL_RUN_LIMIT_KEY)).get(),
    listTrialsForAdmin(db),
    db
      .select({
        userId: trialAllowances.userId,
        extraRuns: trialAllowances.extraRuns,
        updatedAt: trialAllowances.updatedAt,
        email: users.email,
        role: users.role,
      })
      .from(trialAllowances)
      .leftJoin(users, eq(users.id, trialAllowances.userId))
      .all(),
  ]);

  // Per-trial discovery spend from the Apify ledger (trial sweeps log with
  // scan_id = trial id and no talent). Chunked under the D1 parameter cap.
  const spendByTrial = new Map<string, number>();
  const trialIds = trials.map((t) => t.id);
  for (let i = 0; i < trialIds.length; i += 80) {
    const chunk = trialIds.slice(i, i + 80);
    const rows = await db
      .select({ scanId: apifyUsage.scanId, cost: sql<number>`sum(${apifyUsage.costUsd})` })
      .from(apifyUsage)
      .where(inArray(apifyUsage.scanId, chunk))
      .groupBy(apifyUsage.scanId)
      .all();
    for (const r of rows) {
      if (r.scanId) spendByTrial.set(r.scanId, r.cost ?? 0);
    }
  }

  // Runs used per requester, so the allowance panel shows used/limit at a
  // glance without a second request.
  const usedByUser = new Map<string, number>();
  {
    const rows = await db
      .select({ requestedBy: trialScans.requestedBy, n: sql<number>`count(*)` })
      .from(trialScans)
      .where(and(inArray(trialScans.status, ["running", "complete"])))
      .groupBy(trialScans.requestedBy)
      .all();
    for (const r of rows) usedByUser.set(r.requestedBy, r.n);
  }

  const defaultLimitParsed = parseInt(limitRow?.value ?? "", 10);
  return NextResponse.json({
    settings: {
      enabled: enabledRow?.value !== "false",
      runLimitDefault:
        Number.isFinite(defaultLimitParsed) && defaultLimitParsed >= 0
          ? defaultLimitParsed
          : DEFAULT_TRIAL_RUN_LIMIT,
    },
    trials: trials.map((t) => ({ ...t, costUsd: spendByTrial.get(t.id) ?? 0 })),
    allowances: allowanceRows.map((a) => ({
      userId: a.userId,
      email: a.email ?? "(deleted account)",
      role: a.role ?? null,
      extraRuns: a.extraRuns,
      used: usedByUser.get(a.userId) ?? 0,
      updatedAt: a.updatedAt,
    })),
  });
}
