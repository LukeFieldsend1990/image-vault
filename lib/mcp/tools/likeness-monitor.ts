/**
 * Read-only visibility into the likeness monitor: recorded hits and scan
 * activity across all talent, for admin triage support from Claude.
 */

import { registerMcpTool } from "../registry";
import { likenessHits, monitorScans, users } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, 1), max);
}

const HIT_STATUSES = new Set(["new", "confirmed", "dismissed", "takedown_requested", "resolved"]);

registerMcpTool({
  name: "list_likeness_hits",
  description:
    "Likeness monitor hits (AI-flagged unauthorised likeness usage on public platforms), newest first. " +
    "Filter by status (new | confirmed | dismissed | takedown_requested | resolved) or talent email. " +
    "Includes per-hit confidence, risk level, adjudicator rationale and content URL.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter by triage status" },
      talent_email: { type: "string", description: "Filter by talent account email" },
      limit: { type: "number", description: "Max rows (default 20, max 100)" },
    },
  },
  mutating: false,
  async execute(ctx, params) {
    const limit = clampLimit(params.limit, 20, 100);
    const conditions = [];

    if (typeof params.status === "string" && params.status) {
      if (!HIT_STATUSES.has(params.status)) {
        return { success: false, message: `Unknown status "${params.status}".` };
      }
      conditions.push(eq(likenessHits.status, params.status as "new"));
    }
    if (typeof params.talent_email === "string" && params.talent_email) {
      const talent = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, params.talent_email.trim().toLowerCase()))
        .get();
      if (!talent) return { success: false, message: `No user with email ${params.talent_email}.` };
      conditions.push(eq(likenessHits.talentId, talent.id));
    }

    const rows = await ctx.db
      .select({
        id: likenessHits.id,
        talentEmail: users.email,
        platform: likenessHits.platform,
        contentUrl: likenessHits.contentUrl,
        authorHandle: likenessHits.authorHandle,
        confidence: likenessHits.confidence,
        aiGeneratedLikelihood: likenessHits.aiGeneratedLikelihood,
        riskLevel: likenessHits.riskLevel,
        aiRationale: likenessHits.aiRationale,
        status: likenessHits.status,
        detectedAt: likenessHits.detectedAt,
      })
      .from(likenessHits)
      .leftJoin(users, eq(users.id, likenessHits.talentId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(likenessHits.detectedAt))
      .limit(limit)
      .all();

    const scanStats = await ctx.db
      .select({
        total: sql<number>`count(*)`,
        aiAdjudicated: sql<number>`sum(case when ai_provider = 'ai' then 1 else 0 end)`,
      })
      .from(monitorScans)
      .get();

    return {
      success: true,
      message: `${rows.length} hit(s) returned. ${scanStats?.total ?? 0} scan(s) run platform-wide (${scanStats?.aiAdjudicated ?? 0} AI-adjudicated).`,
      data: { hits: rows },
    };
  },
});
