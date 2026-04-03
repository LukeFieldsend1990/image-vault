export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { aiCostLog, aiSettings } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, gt, desc, sql } from "drizzle-orm";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

/**
 * GET /api/admin/ai/costs
 * Returns rolling 14-day AI cost analytics.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const fourteenDaysAgo = now - 14 * 24 * 60 * 60;

  // Total spend in the 14-day window
  const totalRow = await db
    .select({ total: sql<number>`coalesce(sum(${aiCostLog.estimatedCostUsd}), 0)` })
    .from(aiCostLog)
    .where(gt(aiCostLog.createdAt, fourteenDaysAgo))
    .get();
  const totalSpend = totalRow?.total ?? 0;

  // Budget ceiling from settings
  const ceilingRow = await db
    .select({ value: aiSettings.value })
    .from(aiSettings)
    .where(eq(aiSettings.key, "budget_ceiling_usd"))
    .get();
  const ceiling = ceilingRow ? parseFloat(ceilingRow.value) : null;

  // By feature
  const byFeature = await db
    .select({
      feature: aiCostLog.feature,
      totalCost: sql<number>`coalesce(sum(${aiCostLog.estimatedCostUsd}), 0)`,
      callCount: sql<number>`count(*)`,
    })
    .from(aiCostLog)
    .where(gt(aiCostLog.createdAt, fourteenDaysAgo))
    .groupBy(aiCostLog.feature)
    .all();

  // By provider
  const byProvider = await db
    .select({
      provider: aiCostLog.provider,
      totalCost: sql<number>`coalesce(sum(${aiCostLog.estimatedCostUsd}), 0)`,
      callCount: sql<number>`count(*)`,
    })
    .from(aiCostLog)
    .where(gt(aiCostLog.createdAt, fourteenDaysAgo))
    .groupBy(aiCostLog.provider)
    .all();

  // Recent logs
  const recentLogs = await db
    .select()
    .from(aiCostLog)
    .orderBy(desc(aiCostLog.createdAt))
    .limit(50)
    .all();

  // Projected spend: (totalSpend / daysSinceOldestInWindow) * 14
  const oldestRow = await db
    .select({ oldest: sql<number>`min(${aiCostLog.createdAt})` })
    .from(aiCostLog)
    .where(gt(aiCostLog.createdAt, fourteenDaysAgo))
    .get();

  let projectedSpend = 0;
  if (oldestRow?.oldest && totalSpend > 0) {
    const daysSinceOldest = Math.max((now - oldestRow.oldest) / (24 * 60 * 60), 1);
    projectedSpend = (totalSpend / daysSinceOldest) * 14;
  }

  return NextResponse.json({
    totalSpend,
    ceiling,
    byFeature,
    byProvider,
    recentLogs,
    projectedSpend,
  });
}
