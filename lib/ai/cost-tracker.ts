import { getDb } from "@/lib/db";
import { aiCostLog, aiSettings } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

export async function logAiCost(
  db: Db,
  entry: {
    provider: string;
    model: string;
    feature: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    error?: string;
  }
) {
  await db.insert(aiCostLog).values({
    id: crypto.randomUUID(),
    provider: entry.provider,
    model: entry.model,
    feature: entry.feature,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    estimatedCostUsd: entry.estimatedCostUsd,
    error: entry.error ?? null,
    createdAt: Math.floor(Date.now() / 1000),
  });
}

export async function checkBudget(
  db: Db,
  ceilingOverride?: number
): Promise<{ spent: number; ceiling: number; exhausted: boolean }> {
  const fourteenDaysAgo = Math.floor(Date.now() / 1000) - 14 * 86400;

  const [spentRow, ceilingRow] = await Promise.all([
    db
      .select({ total: sql<number>`coalesce(sum(estimated_cost_usd), 0)` })
      .from(aiCostLog)
      .where(sql`created_at > ${fourteenDaysAgo}`)
      .get(),
    ceilingOverride !== undefined
      ? Promise.resolve(null)
      : db
          .select({ value: aiSettings.value })
          .from(aiSettings)
          .where(eq(aiSettings.key, "budget_ceiling_usd"))
          .get(),
  ]);

  const spent = spentRow?.total ?? 0;
  const ceiling = ceilingOverride ?? parseFloat(ceilingRow?.value ?? "1.00");

  return { spent, ceiling, exhausted: spent >= ceiling };
}

export async function isAiEnabled(db: Db): Promise<boolean> {
  const row = await db
    .select({ value: aiSettings.value })
    .from(aiSettings)
    .where(eq(aiSettings.key, "enabled"))
    .get();
  return row?.value === "true";
}

export async function isFeatureEnabled(db: Db, feature: string): Promise<boolean> {
  const keyMap: Record<string, string> = {
    fee_guidance: "fee_guidance_enabled",
    licence_summary: "licence_summary_enabled",
  };
  const key = keyMap[feature];
  if (!key) return true; // features without a toggle are always on when master is on
  const row = await db
    .select({ value: aiSettings.value })
    .from(aiSettings)
    .where(eq(aiSettings.key, key))
    .get();
  return row?.value === "true";
}

export async function getSettingValue(db: Db, key: string): Promise<string | null> {
  const row = await db
    .select({ value: aiSettings.value })
    .from(aiSettings)
    .where(eq(aiSettings.key, key))
    .get();
  return row?.value ?? null;
}
