/**
 * AI Cron Worker
 *
 * Scheduled worker that runs the suggestion engine batch twice daily.
 * Operates directly on D1 + Workers AI — no HTTP round-trip to the Pages app.
 *
 * Cron schedule: 07:00 UTC, 14:00 UTC
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, and, sql, isNull, inArray } from "drizzle-orm";
import {
  users,
  refreshTokens,
  talentReps,
  talentProfiles,
  licences,
  scanPackages,
  scanFiles,
  suggestions,
  aiSettings,
  aiCostLog,
} from "./schema";

// ── Types ──────────────────────────────────────────────────────────────────

interface Env {
  DB: D1Database;
  AI: Ai;
  ANTHROPIC_API_KEY?: string;
  APP_URL: string;
}

interface Signal {
  type: string;
  data: Record<string, unknown>;
}

interface SuggestionFromLLM {
  title: string;
  body: string;
  category: string;
  deepLink: string;
  entityType: string;
  entityId: string;
  priority: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const SUGGESTION_TTL = 7 * 24 * 60 * 60; // 7 days
const ACTIVE_WINDOW = 48 * 60 * 60; // 48 hours
const MAX_SUGGESTIONS_PER_REP = 10;

const HAIKU_PRICING = { input: 0.80 / 1_000_000, output: 4.00 / 1_000_000 };

const SYSTEM_PROMPT = `You are an assistant for talent representatives managing digital likeness licensing.

You will receive a JSON object containing signals about the rep's managed talent.
Each signal has a type, the relevant entity data, and computed metrics.

Your job is to:
1. Prioritise signals by urgency: expiring licences and security events first,
   then pending requests, then login anomalies, then revenue insights.
2. For each signal, write a 1-2 sentence suggestion in plain English.
3. Include specific numbers, names, and dates from the data — never invent facts.
4. Assign a category: action_required, attention, or insight.
5. Suggest a clear next action (e.g., "review the request", "contact the licensee").

Return a JSON array of suggestion objects. Maximum 10 suggestions.

Schema: [{ "title": string, "body": string, "category": "action_required"|"attention"|"insight", "deepLink": string, "entityType": "licence"|"package"|"talent"|"download", "entityId": string, "priority": number (0=highest, 100=lowest) }]

Do not include disclaimers, greetings, or commentary outside the JSON array.`;

// ── Helpers ────────────────────────────────────────────────────────────────

type Db = ReturnType<typeof drizzle>;

async function isEnabled(db: Db): Promise<boolean> {
  const row = await db
    .select({ value: aiSettings.value })
    .from(aiSettings)
    .where(eq(aiSettings.key, "enabled"))
    .get();
  return row?.value === "true";
}

async function isBudgetExhausted(db: Db): Promise<boolean> {
  const fourteenDaysAgo = Math.floor(Date.now() / 1000) - 14 * 86400;
  const [spentRow, ceilingRow] = await Promise.all([
    db.select({ total: sql<number>`coalesce(sum(estimated_cost_usd), 0)` })
      .from(aiCostLog).where(sql`created_at > ${fourteenDaysAgo}`).get(),
    db.select({ value: aiSettings.value })
      .from(aiSettings).where(eq(aiSettings.key, "budget_ceiling_usd")).get(),
  ]);
  const spent = spentRow?.total ?? 0;
  const ceiling = parseFloat(ceilingRow?.value ?? "1.00");
  return spent >= ceiling;
}

async function logCost(db: Db, entry: {
  provider: string; model: string; feature: string;
  inputTokens: number; outputTokens: number; estimatedCostUsd: number; error?: string;
}) {
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

// ── Signal Gathering ───────────────────────────────────────────────────────

async function getTalentIds(db: Db, repId: string): Promise<string[]> {
  const rows = await db.select({ talentId: talentReps.talentId })
    .from(talentReps).where(eq(talentReps.repId, repId)).all();
  return rows.map((r) => r.talentId);
}

async function gatherSignals(db: Db, repId: string): Promise<Signal[]> {
  const talentIds = await getTalentIds(db, repId);
  if (talentIds.length === 0) return [];

  const now = Math.floor(Date.now() / 1000);
  const signals: Signal[] = [];

  // Get talent name map
  const profiles = await db.select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
    .from(talentProfiles).where(inArray(talentProfiles.userId, talentIds)).all();
  const nameMap = new Map(profiles.map((p) => [p.userId, p.fullName]));

  // 1. Pending licences
  const pending = await db.select({
    id: licences.id, talentId: licences.talentId, projectName: licences.projectName,
    productionCompany: licences.productionCompany, licenceType: licences.licenceType,
    proposedFee: licences.proposedFee, createdAt: licences.createdAt,
  }).from(licences)
    .where(and(inArray(licences.talentId, talentIds), eq(licences.status, "PENDING")))
    .all();

  const byTalent = new Map<string, typeof pending>();
  for (const p of pending) {
    const list = byTalent.get(p.talentId) ?? [];
    list.push(p);
    byTalent.set(p.talentId, list);
  }
  for (const [tid, items] of byTalent) {
    const oldest = Math.min(...items.map((i) => i.createdAt));
    signals.push({
      type: "pending_licences",
      data: {
        talentId: tid, talentName: nameMap.get(tid) ?? "Unknown",
        count: items.length, oldestDaysAgo: Math.floor((now - oldest) / 86400),
        licences: items.map((i) => ({
          id: i.id, projectName: i.projectName, productionCompany: i.productionCompany,
          licenceType: i.licenceType, proposedFee: i.proposedFee,
        })),
      },
    });
  }

  // 2. Expiring licences with no downloads
  const thirtyDays = now + 30 * 86400;
  const expiring = await db.select({
    id: licences.id, talentId: licences.talentId, projectName: licences.projectName,
    productionCompany: licences.productionCompany, licenseeId: licences.licenseeId,
    validTo: licences.validTo, agreedFee: licences.agreedFee,
  }).from(licences)
    .where(and(
      inArray(licences.talentId, talentIds), eq(licences.status, "APPROVED"),
      sql`valid_to < ${thirtyDays}`, sql`valid_to > ${now}`, eq(licences.downloadCount, 0),
    )).all();

  if (expiring.length > 0) {
    const licenseeIds = [...new Set(expiring.map((e) => e.licenseeId))];
    const licensees = await db.select({ id: users.id, email: users.email, phone: users.phone })
      .from(users).where(inArray(users.id, licenseeIds)).all();
    const lMap = new Map(licensees.map((l) => [l.id, l]));

    for (const e of expiring) {
      const lic = lMap.get(e.licenseeId);
      signals.push({
        type: "expiring_no_download",
        data: {
          licenceId: e.id, talentId: e.talentId, talentName: nameMap.get(e.talentId) ?? "Unknown",
          projectName: e.projectName, productionCompany: e.productionCompany,
          daysUntilExpiry: Math.floor((e.validTo - now) / 86400),
          agreedFee: e.agreedFee, licenseeEmail: lic?.email ?? null, licenseePhone: lic?.phone ?? null,
        },
      });
    }
  }

  // 3. High login frequency
  const sevenDaysAgo = now - 7 * 86400;
  const loginCounts = await db.select({
    userId: refreshTokens.userId, loginCount: sql<number>`count(*)`,
  }).from(refreshTokens)
    .where(and(inArray(refreshTokens.userId, talentIds), sql`created_at > ${sevenDaysAgo}`))
    .groupBy(refreshTokens.userId).all();

  for (const lc of loginCounts) {
    if (lc.loginCount >= 4) {
      signals.push({
        type: "high_login_frequency",
        data: {
          talentId: lc.userId, talentName: nameMap.get(lc.userId) ?? "Unknown",
          loginsThisWeek: lc.loginCount,
        },
      });
    }
  }

  // 4. Revenue opportunities (proposed fee below average)
  const pendingWithFees = pending.filter((p) => p.proposedFee && p.proposedFee > 0 && p.licenceType);
  for (const p of pendingWithFees) {
    const comps = await db.select({ agreedFee: licences.agreedFee }).from(licences)
      .where(and(eq(licences.status, "APPROVED"), eq(licences.licenceType, p.licenceType!),
        sql`agreed_fee IS NOT NULL AND agreed_fee > 0`)).all();
    if (comps.length < 3) continue;
    const fees = comps.map((c) => c.agreedFee!).sort((a, b) => a - b);
    const avg = Math.round(fees.reduce((s, f) => s + f, 0) / fees.length);
    if (p.proposedFee! < avg * 0.8) {
      signals.push({
        type: "revenue_opportunity",
        data: {
          licenceId: p.id, talentId: p.talentId, projectName: p.projectName,
          licenceType: p.licenceType, proposedFee: p.proposedFee,
          averageFee: avg, percentBelow: Math.round((1 - p.proposedFee! / avg) * 100),
          comparableCount: comps.length,
        },
      });
    }
  }

  // 5. Stale packages (no licence activity in 90 days)
  const ninetyDaysAgo = now - 90 * 86400;
  const packages = await db.select({
    id: scanPackages.id, talentId: scanPackages.talentId, name: scanPackages.name,
  }).from(scanPackages)
    .where(and(inArray(scanPackages.talentId, talentIds), eq(scanPackages.status, "ready")))
    .all();

  const stalePkgs: Array<{ talentId: string; name: string; id: string }> = [];
  for (const pkg of packages) {
    const recent = await db.select({ id: licences.id }).from(licences)
      .where(and(eq(licences.packageId, pkg.id), sql`created_at > ${ninetyDaysAgo}`))
      .limit(1).get();
    if (!recent) stalePkgs.push(pkg);
  }

  const staleByTalent = new Map<string, typeof stalePkgs>();
  for (const sp of stalePkgs) {
    const list = staleByTalent.get(sp.talentId) ?? [];
    list.push(sp);
    staleByTalent.set(sp.talentId, list);
  }
  for (const [tid, pkgs] of staleByTalent) {
    signals.push({
      type: "stale_packages",
      data: {
        talentId: tid, talentName: nameMap.get(tid) ?? "Unknown",
        packageCount: pkgs.length,
        packages: pkgs.map((p) => ({ packageId: p.id, packageName: p.name })),
      },
    });
  }

  return signals;
}

// ── LLM Call ───────────────────────────────────────────────────────────────

async function callLLM(
  env: Env, db: Db, signalsJson: string
): Promise<{ text: string; provider: string; model: string; inputTokens: number; outputTokens: number } | null> {
  // Try Workers AI first (free)
  try {
    const res = await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as Parameters<Ai["run"]>[0], {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: signalsJson },
      ],
    }) as { response?: string };
    const text = res?.response ?? "";
    if (text.includes("[")) {
      const inputTokens = Math.ceil((SYSTEM_PROMPT.length + signalsJson.length) / 4);
      const outputTokens = Math.ceil(text.length / 4);
      return { text, provider: "workers_ai", model: "@cf/meta/llama-3.1-8b-instruct", inputTokens, outputTokens };
    }
  } catch { /* fall through to Anthropic */ }

  // Fallback: Anthropic
  if (!env.ANTHROPIC_API_KEY) return null;
  if (await isBudgetExhausted(db)) return null;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: signalsJson }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    const text = data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
    return {
      text, provider: "anthropic", model: "claude-haiku-4-5-20251001",
      inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens,
    };
  } catch {
    return null;
  }
}

// ── Parse & Validate ───────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set(["action_required", "attention", "insight", "security"]);
const VALID_ENTITY_TYPES = new Set(["licence", "package", "talent", "download"]);

function parseSuggestions(text: string): SuggestionFromLLM[] {
  let jsonStr = text.trim();
  const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) jsonStr = codeBlock[1].trim();
  const start = jsonStr.indexOf("[");
  const end = jsonStr.lastIndexOf("]");
  if (start === -1 || end === -1) return [];

  try {
    const arr = JSON.parse(jsonStr.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
      .filter((s) => typeof s.title === "string" && typeof s.body === "string")
      .map((s) => ({
        title: (s.title as string).slice(0, 200),
        body: (s.body as string).slice(0, 500),
        category: VALID_CATEGORIES.has(s.category as string) ? (s.category as string) : "insight",
        deepLink: typeof s.deepLink === "string" ? s.deepLink : "",
        entityType: VALID_ENTITY_TYPES.has(s.entityType as string) ? (s.entityType as string) : "",
        entityId: typeof s.entityId === "string" ? s.entityId : "",
        priority: typeof s.priority === "number" ? Math.max(0, Math.min(100, s.priority)) : 50,
      }))
      .slice(0, MAX_SUGGESTIONS_PER_REP);
  } catch {
    return [];
  }
}

// ── Main Scheduled Handler ─────────────────────────────────────────────────

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = drizzle(env.DB);
    const now = Math.floor(Date.now() / 1000);

    // Pre-flight checks
    if (!(await isEnabled(db))) {
      console.log("AI features disabled — skipping batch");
      return;
    }
    if (await isBudgetExhausted(db)) {
      console.log("Budget exhausted — skipping batch");
      return;
    }

    // Find active reps (logged in within 48h)
    const cutoff = now - ACTIVE_WINDOW;
    const activeReps = await db.select({ id: users.id, email: users.email })
      .from(users)
      .innerJoin(refreshTokens, eq(users.id, refreshTokens.userId))
      .where(and(eq(users.role, "rep"), sql`${refreshTokens.createdAt} > ${cutoff}`, isNull(users.suspendedAt)))
      .groupBy(users.id)
      .all();

    if (activeReps.length === 0) {
      console.log("No active reps — skipping batch");
      return;
    }

    const batchId = crypto.randomUUID();
    let totalSuggestions = 0;

    for (const rep of activeReps) {
      // Re-check budget per rep
      if (await isBudgetExhausted(db)) {
        console.log(`Budget exhausted mid-batch at rep ${rep.id}`);
        break;
      }

      const signals = await gatherSignals(db, rep.id);
      if (signals.length === 0) continue;

      const result = await callLLM(env, db, JSON.stringify({ repId: rep.id, signals }));
      if (!result) {
        console.log(`LLM call failed for rep ${rep.id}`);
        continue;
      }

      // Log cost
      const cost = result.provider === "anthropic"
        ? result.inputTokens * HAIKU_PRICING.input + result.outputTokens * HAIKU_PRICING.output
        : 0;

      await logCost(db, {
        provider: result.provider, model: result.model, feature: "suggestions",
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        estimatedCostUsd: cost,
      });

      const parsed = parseSuggestions(result.text);
      if (parsed.length === 0) continue;

      // Clean expired suggestions
      await db.delete(suggestions).where(
        and(eq(suggestions.userId, rep.id), isNull(suggestions.acknowledgedAt), sql`expires_at < ${now}`)
      );

      // Insert new suggestions (skip duplicates)
      for (const s of parsed) {
        if (s.entityType && s.entityId) {
          const existing = await db.select({ id: suggestions.id }).from(suggestions)
            .where(and(
              eq(suggestions.userId, rep.id), eq(suggestions.entityType, s.entityType),
              eq(suggestions.entityId, s.entityId), isNull(suggestions.acknowledgedAt),
              sql`expires_at > ${now}`,
            )).limit(1).get();
          if (existing) continue;
        }

        await db.insert(suggestions).values({
          id: crypto.randomUUID(), userId: rep.id,
          category: s.category, feature: "rep_suggestions",
          title: s.title, body: s.body,
          deepLink: s.deepLink || null, entityType: s.entityType || null,
          entityId: s.entityId || null, priority: s.priority,
          acknowledgedAt: null, clickedAt: null,
          expiresAt: now + SUGGESTION_TTL, batchId, createdAt: now,
        });
        totalSuggestions++;
      }
    }

    console.log(`Batch ${batchId}: ${activeReps.length} reps, ${totalSuggestions} suggestions created`);
  },
};
