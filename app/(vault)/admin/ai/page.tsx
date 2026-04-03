export const runtime = "edge";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { aiSettings, aiCostLog, aiBatchRuns } from "@/lib/db/schema";
import { sql, desc } from "drizzle-orm";
import { AiSettingsClient } from "./ai-settings-client";

export default async function AdminAiPage() {
  await requireAdmin();
  const db = getDb();

  const fourteenDaysAgo = Math.floor(Date.now() / 1000) - 14 * 86400;

  const [settingsRows, totalSpendRow, byFeatureRows, byProviderRows, ceilingRow, recentBatchRuns, recentLogs] =
    await Promise.all([
      db.select({ key: aiSettings.key, value: aiSettings.value }).from(aiSettings).all(),
      db
        .select({ total: sql<number>`coalesce(sum(estimated_cost_usd), 0)` })
        .from(aiCostLog)
        .where(sql`created_at >= ${fourteenDaysAgo}`)
        .get(),
      db
        .select({
          feature: aiCostLog.feature,
          cost: sql<number>`coalesce(sum(estimated_cost_usd), 0)`,
          calls: sql<number>`count(*)`,
        })
        .from(aiCostLog)
        .where(sql`created_at >= ${fourteenDaysAgo}`)
        .groupBy(aiCostLog.feature)
        .orderBy(sql`sum(estimated_cost_usd) desc`)
        .all(),
      db
        .select({
          provider: aiCostLog.provider,
          cost: sql<number>`coalesce(sum(estimated_cost_usd), 0)`,
          calls: sql<number>`count(*)`,
        })
        .from(aiCostLog)
        .where(sql`created_at >= ${fourteenDaysAgo}`)
        .groupBy(aiCostLog.provider)
        .orderBy(sql`sum(estimated_cost_usd) desc`)
        .all(),
      db
        .select({ value: aiSettings.value })
        .from(aiSettings)
        .where(sql`key = 'budget_ceiling_usd'`)
        .get(),
      db
        .select({
          id: aiBatchRuns.id,
          triggerType: aiBatchRuns.triggerType,
          status: aiBatchRuns.status,
          initiatedByEmail: aiBatchRuns.initiatedByEmail,
          repsTargeted: aiBatchRuns.repsTargeted,
          repsProcessed: aiBatchRuns.repsProcessed,
          suggestionsCreated: aiBatchRuns.suggestionsCreated,
          skipped: aiBatchRuns.skipped,
          error: aiBatchRuns.error,
          startedAt: aiBatchRuns.startedAt,
          completedAt: aiBatchRuns.completedAt,
        })
        .from(aiBatchRuns)
        .orderBy(desc(aiBatchRuns.startedAt))
        .limit(10)
        .all(),
      db
        .select({
          id: aiCostLog.id,
          feature: aiCostLog.feature,
          provider: aiCostLog.provider,
          model: aiCostLog.model,
          inputTokens: aiCostLog.inputTokens,
          outputTokens: aiCostLog.outputTokens,
          estimatedCostUsd: aiCostLog.estimatedCostUsd,
          error: aiCostLog.error,
          prompt: aiCostLog.prompt,
          response: aiCostLog.response,
          createdAt: aiCostLog.createdAt,
        })
        .from(aiCostLog)
        .orderBy(desc(aiCostLog.createdAt))
        .limit(20)
        .all(),
    ]);

  const initialSettings: Record<string, string> = {};
  for (const row of settingsRows) {
    initialSettings[row.key] = row.value;
  }

  const ceiling = parseFloat(ceilingRow?.value ?? "50");
  const totalSpend = totalSpendRow?.total ?? 0;

  const initialCosts = {
    totalSpend,
    ceiling,
    byFeature: byFeatureRows.map((r) => ({
      feature: r.feature,
      cost: r.cost,
      calls: r.calls,
    })),
    byProvider: byProviderRows.map((r) => ({
      provider: r.provider,
      cost: r.cost,
      calls: r.calls,
    })),
  };

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <Link
          href="/settings?tab=admin"
          className="text-xs mb-3 inline-block"
          style={{ color: "var(--color-accent)" }}
        >
          &larr; Back to Settings
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[9px] uppercase tracking-[0.2em] font-semibold px-2 py-0.5 rounded"
            style={{ background: "rgba(192,57,43,0.12)", color: "var(--color-accent)" }}
          >
            Admin
          </span>
        </div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
          AI Features
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Manage AI capabilities, monitor costs and trigger batch jobs.
        </p>
      </div>

      <AiSettingsClient
        initialSettings={initialSettings}
        initialCosts={initialCosts}
        recentBatchRuns={recentBatchRuns.map((r) => ({
          id: r.id,
          triggerType: r.triggerType,
          status: r.status,
          initiatedByEmail: r.initiatedByEmail,
          repsTargeted: r.repsTargeted,
          repsProcessed: r.repsProcessed,
          suggestionsCreated: r.suggestionsCreated,
          skipped: r.skipped,
          error: r.error,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
        }))}
        recentLogs={recentLogs.map((l) => ({
          id: l.id,
          feature: l.feature,
          provider: l.provider,
          model: l.model,
          inputTokens: l.inputTokens,
          outputTokens: l.outputTokens,
          cost: l.estimatedCostUsd,
          error: l.error,
          prompt: l.prompt,
          response: l.response,
          createdAt: l.createdAt,
        }))}
      />
    </div>
  );
}
