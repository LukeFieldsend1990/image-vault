import type { drizzle } from "drizzle-orm/d1";
import { users, refreshTokens, talentReps, suggestions } from "@/lib/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { callAi } from "./providers";
import { isAiEnabled, checkBudget } from "./cost-tracker";
import {
  REP_SUGGESTION_PROMPT,
  SUGGESTION_TTL_SECONDS,
  MAX_SUGGESTIONS_PER_REP,
  ACTIVE_USER_WINDOW_SECONDS,
} from "./constants";
import { gatherSignalsForRep } from "./signals";

type Db = ReturnType<typeof drizzle>;

interface SuggestionFromLLM {
  title: string;
  body: string;
  category: string;
  deepLink: string;
  entityType: string;
  entityId: string;
  priority: number;
}

const VALID_CATEGORIES = new Set(["action_required", "attention", "insight", "security"]);
const VALID_ENTITY_TYPES = new Set(["licence", "package", "talent", "download"]);

function validateSuggestion(s: unknown): SuggestionFromLLM | null {
  if (!s || typeof s !== "object") return null;
  const obj = s as Record<string, unknown>;
  if (typeof obj.title !== "string" || !obj.title) return null;
  if (typeof obj.body !== "string" || !obj.body) return null;
  const category = VALID_CATEGORIES.has(obj.category as string)
    ? (obj.category as string)
    : "insight";
  const entityType = VALID_ENTITY_TYPES.has(obj.entityType as string)
    ? (obj.entityType as string)
    : null;
  return {
    title: obj.title.slice(0, 200),
    body: obj.body.slice(0, 500),
    category,
    deepLink: typeof obj.deepLink === "string" ? obj.deepLink : "",
    entityType: entityType ?? "",
    entityId: typeof obj.entityId === "string" ? obj.entityId : "",
    priority: typeof obj.priority === "number" ? Math.max(0, Math.min(100, obj.priority)) : 50,
  };
}

function parseLLMResponse(text: string): SuggestionFromLLM[] {
  // Try to extract JSON array from response
  const trimmed = text.trim();
  let jsonStr = trimmed;

  // Handle markdown code blocks
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  // Find array bounds
  const start = jsonStr.indexOf("[");
  const end = jsonStr.lastIndexOf("]");
  if (start === -1 || end === -1) return [];

  try {
    const arr = JSON.parse(jsonStr.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .map(validateSuggestion)
      .filter((s): s is SuggestionFromLLM => s !== null)
      .slice(0, MAX_SUGGESTIONS_PER_REP);
  } catch {
    return [];
  }
}

async function getActiveReps(db: Db, skipActivityCheck: boolean): Promise<Array<{ id: string; email: string }>> {
  if (skipActivityCheck) {
    // Manual trigger: return all non-suspended reps
    return db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.role, "rep"), isNull(users.suspendedAt)))
      .all();
  }

  const cutoff = Math.floor(Date.now() / 1000) - ACTIVE_USER_WINDOW_SECONDS;

  // Find reps who have active refresh tokens created within the last 48h
  const activeReps = await db
    .select({
      id: users.id,
      email: users.email,
    })
    .from(users)
    .innerJoin(refreshTokens, eq(users.id, refreshTokens.userId))
    .where(
      and(
        eq(users.role, "rep"),
        sql`${refreshTokens.createdAt} > ${cutoff}`,
        isNull(users.suspendedAt)
      )
    )
    .groupBy(users.id)
    .all();

  return activeReps;
}

export async function runSuggestionBatch(
  env: { AI?: Ai; ANTHROPIC_API_KEY?: string },
  db: Db,
  options?: { manual?: boolean }
): Promise<{
  repsProcessed: number;
  suggestionsCreated: number;
  skipped: string[];
}> {
  const manual = options?.manual ?? false;

  const enabled = await isAiEnabled(db);
  if (!enabled) return { repsProcessed: 0, suggestionsCreated: 0, skipped: ["ai_disabled"] };

  const budget = await checkBudget(db);
  if (budget.exhausted) return { repsProcessed: 0, suggestionsCreated: 0, skipped: ["budget_exhausted"] };

  const reps = await getActiveReps(db, manual);
  if (reps.length === 0) return { repsProcessed: 0, suggestionsCreated: 0, skipped: ["no_active_reps"] };

  const now = Math.floor(Date.now() / 1000);
  const batchId = crypto.randomUUID();
  let totalSuggestions = 0;
  const skipped: string[] = [];

  for (const rep of reps) {
    // Check budget before each rep (in case we exhaust mid-batch)
    const budgetCheck = await checkBudget(db);
    if (budgetCheck.exhausted) {
      skipped.push(`budget_exhausted_at_rep_${rep.id}`);
      break;
    }

    const signals = await gatherSignalsForRep(db, rep.id);
    if (signals.length === 0) {
      skipped.push(`no_signals_${rep.id}`);
      continue;
    }

    const result = await callAi(env, db, {
      feature: "suggestions",
      requiresReasoning: false,
      system: REP_SUGGESTION_PROMPT,
      userMessage: JSON.stringify({ repId: rep.id, signals }),
    });

    if (!result) {
      skipped.push(`ai_call_failed_${rep.id}`);
      continue;
    }

    const parsed = parseLLMResponse(result.text);
    if (parsed.length === 0) {
      skipped.push(`parse_failed_${rep.id}`);
      continue;
    }

    // Clear expired unacknowledged suggestions for this rep
    await db
      .delete(suggestions)
      .where(
        and(
          eq(suggestions.userId, rep.id),
          isNull(suggestions.acknowledgedAt),
          sql`expires_at < ${now}`
        )
      );

    // Insert new suggestions (skip if duplicate entity_type + entity_id exists unacknowledged)
    for (const s of parsed) {
      // Check for existing unacknowledged suggestion for same entity
      if (s.entityType && s.entityId) {
        const existing = await db
          .select({ id: suggestions.id })
          .from(suggestions)
          .where(
            and(
              eq(suggestions.userId, rep.id),
              eq(suggestions.entityType, s.entityType),
              eq(suggestions.entityId, s.entityId),
              isNull(suggestions.acknowledgedAt),
              sql`expires_at > ${now}`
            )
          )
          .limit(1)
          .get();

        if (existing) continue; // Don't duplicate
      }

      await db.insert(suggestions).values({
        id: crypto.randomUUID(),
        userId: rep.id,
        category: s.category,
        feature: "rep_suggestions",
        title: s.title,
        body: s.body,
        deepLink: s.deepLink || null,
        entityType: s.entityType || null,
        entityId: s.entityId || null,
        priority: s.priority,
        acknowledgedAt: null,
        clickedAt: null,
        expiresAt: now + SUGGESTION_TTL_SECONDS,
        batchId,
        createdAt: now,
      });
      totalSuggestions++;
    }
  }

  return { repsProcessed: reps.length, suggestionsCreated: totalSuggestions, skipped };
}
