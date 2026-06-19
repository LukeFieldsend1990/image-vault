/**
 * Ambient security agent.
 *
 * When heuristics in security-alerts.ts escalate an event, this module runs a
 * multi-turn Anthropic tool-use loop that investigates using the READ-ONLY
 * MCP tool registry (in-process, no HTTP), then delivers a triaged verdict:
 * a suggestions row plus an email to the admins. Corrective action is never
 * taken by the agent — it can only recommend the TOTP-gated mutating tools
 * for a human admin to run.
 *
 * Every tool call is executed under a system mcpTokens identity and written
 * to mcp_audit_log, so agent activity is visible at /admin/mcp. Revoking that
 * token (revoke_mcp_token) permanently disables the agent's tool access —
 * the bootstrap never resurrects a revoked token.
 */

import { eq, sql, and, inArray, desc } from "drizzle-orm";
import { mcpTokens, users, suggestions } from "@/lib/db/schema";
import { getAllMcpTools, getMcpTool } from "@/lib/mcp/registry";
import { logMcpCall } from "@/lib/mcp/audit";
import type { McpTokenPayload } from "@/lib/mcp/types";
import type { getDb } from "@/lib/db";
import { isAiEnabled, isFeatureEnabled, checkBudget, logAiCost } from "./cost-tracker";
import { SECURITY_AGENT_PROMPT, PRICING } from "./constants";
import { writeSuggestion, type SecurityTrigger } from "./security-alerts";
import { ADMIN_EMAILS } from "@/lib/auth/adminEmails";
import { securityAlertEmail } from "@/lib/email/templates";
import { sendEmailDirect } from "@/lib/email/send-direct";

// Register ONLY the read-only tool modules. Deliberately not
// "@/lib/mcp/tools" (index) — onboarding.ts would drag
// @opennextjs/cloudflare and lib/email/send into the ai-worker bundle.
import "@/lib/mcp/tools/visibility";
import "@/lib/mcp/tools/semantic";

type Db = ReturnType<typeof getDb>;

export interface SecurityAgentEnv {
  ANTHROPIC_API_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  APP_URL?: string;
}

// ── Guardrails ───────────────────────────────────────────────────────────────

export const AGENT_MAX_TOOL_TURNS = 6;           // tool-use round trips before forced stop
export const AGENT_MAX_TOKENS_PER_CALL = 1024;   // max_tokens on every /v1/messages call
export const AGENT_MAX_TOOL_RESULT_CHARS = 4000; // tool_result JSON truncated to this
export const AGENT_MAX_RUNS_PER_DAY = 4;         // via suggestions feature "security_agent"
export const AGENT_MODEL = "claude-haiku-4-5-20251001";
export const AGENT_TOKEN_DISPLAY_NAME = "system: security-agent";
export const AGENT_TOKEN_TTL_SECONDS = 365 * 86400; // rolling 1-year expiry

const HEADLINE_MAX = 90;
const NARRATIVE_MAX = 600;
const REASON_MAX = 200;

/**
 * Mutating MCP tools the agent may recommend to admins. Kept as an explicit
 * allowlist (matching the enumeration in SECURITY_AGENT_PROMPT) rather than a
 * registry lookup: the agent bundle deliberately does not register the
 * mutating tool modules, and recommendations must never depend on what
 * happens to be bundled.
 */
export const RECOMMENDABLE_TOOLS: readonly string[] = [
  "set_user_suspended",
  "set_user_flag",
  "set_user_role",
  "restore_package",
  "revoke_mcp_token",
  "lock_talent_downloads",
  "revoke_user_sessions",
];

// ── Verdict ──────────────────────────────────────────────────────────────────

export interface SecurityVerdict {
  severity: "critical" | "high" | "medium";
  headline: string;
  narrative: string;
  recommended_actions: Array<{ tool: string; reason: string }>;
}

/**
 * Parse the agent's final JSON verdict. Strict manual validation: unknown
 * severities reject the verdict; recommended_actions are filtered to the
 * RECOMMENDABLE_TOOLS allowlist (drops hallucinated or injection-suggested
 * tool names).
 */
export function parseVerdict(text: string): SecurityVerdict | null {
  const stripped = text.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const v = parsed as Record<string, unknown>;

  if (v.severity !== "critical" && v.severity !== "high" && v.severity !== "medium") return null;
  if (typeof v.headline !== "string" || !v.headline.trim()) return null;
  if (typeof v.narrative !== "string" || !v.narrative.trim()) return null;

  const actions: Array<{ tool: string; reason: string }> = [];
  if (Array.isArray(v.recommended_actions)) {
    for (const a of v.recommended_actions) {
      if (typeof a !== "object" || a === null) continue;
      const tool = (a as Record<string, unknown>).tool;
      const reason = (a as Record<string, unknown>).reason;
      if (typeof tool !== "string" || typeof reason !== "string") continue;
      if (!RECOMMENDABLE_TOOLS.includes(tool)) continue;
      actions.push({ tool, reason: reason.slice(0, REASON_MAX) });
    }
  }

  return {
    severity: v.severity,
    headline: v.headline.trim().slice(0, HEADLINE_MAX),
    narrative: v.narrative.trim().slice(0, NARRATIVE_MAX),
    recommended_actions: actions,
  };
}

/** Deterministic verdict from trigger data, used whenever the loop can't finish. */
export function fallbackVerdict(trigger: SecurityTrigger): SecurityVerdict {
  if (trigger.kind === "bridge") {
    return {
      severity: "high",
      headline: `Bridge ${trigger.eventType.replace(/_/g, " ")} — ${trigger.packageName}`.slice(0, HEADLINE_MAX),
      narrative:
        `${trigger.eventType.replace(/_/g, " ")} detected on device ${trigger.deviceId.slice(0, 8)}... ` +
        `for package "${trigger.packageName}". ${trigger.recentCriticalCount} critical event(s) from this device in the last 24 hours.`,
      recommended_actions: [],
    };
  }
  return {
    severity: "high",
    headline: `Download anomaly — ${trigger.projectName}`.slice(0, HEADLINE_MAX),
    narrative:
      `${trigger.downloads24h} download(s) in 24h on licence "${trigger.projectName}"` +
      (trigger.ip ? ` including activity from a previously unseen IP address (licensee has ${trigger.knownIpCount} known IPs).` : "."),
    recommended_actions: [],
  };
}

// ── MCP → Anthropic tool conversion ─────────────────────────────────────────

export function mcpToolsToAnthropic(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return getAllMcpTools()
    .filter((t) => !t.mutating)
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as unknown as Record<string, unknown>,
    }));
}

// ── System token bootstrap (audit identity + kill switch) ───────────────────

async function sha256Hex(input: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", input as BufferSource);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Returns the system token payload the agent uses for audit logging, creating
 * it on first run. Returns null (agent disabled) when the latest token has
 * been revoked — an admin running revoke_mcp_token on it is the kill switch —
 * or when no admin user exists to own it.
 */
export async function getOrCreateAgentToken(db: Db): Promise<McpTokenPayload | null> {
  const now = Math.floor(Date.now() / 1000);

  const row = await db
    .select({
      id: mcpTokens.id,
      userId: mcpTokens.userId,
      expiresAt: mcpTokens.expiresAt,
      revokedAt: mcpTokens.revokedAt,
      email: users.email,
    })
    .from(mcpTokens)
    .innerJoin(users, eq(users.id, mcpTokens.userId))
    .where(eq(mcpTokens.displayName, AGENT_TOKEN_DISPLAY_NAME))
    .orderBy(desc(mcpTokens.createdAt))
    .limit(1)
    .get();

  if (row) {
    if (row.revokedAt !== null) return null; // kill switch — never resurrect
    if (row.expiresAt > now) {
      // Rolling expiry: extend when within 30 days of lapsing
      if (row.expiresAt < now + 30 * 86400) {
        await db
          .update(mcpTokens)
          .set({ expiresAt: now + AGENT_TOKEN_TTL_SECONDS })
          .where(eq(mcpTokens.id, row.id));
      }
      return { tokenId: row.id, userId: row.userId, email: row.email, scope: "read" };
    }
    // expired (but not revoked): fall through and mint a replacement
  }

  const admins = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, [...ADMIN_EMAILS]))
    .all();
  if (admins.length === 0) return null; // nobody to own the audit trail
  admins.sort((a, b) => ADMIN_EMAILS.indexOf(a.email) - ADMIN_EMAILS.indexOf(b.email));
  const owner = admins[0];

  // Random hash with the preimage discarded: this token can never
  // authenticate at /api/mcp — it exists purely as an audit identity.
  const tokenHash = await sha256Hex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenId = crypto.randomUUID();

  await db.insert(mcpTokens).values({
    id: tokenId,
    userId: owner.id,
    tokenHash,
    displayName: AGENT_TOKEN_DISPLAY_NAME,
    scope: "read",
    createdAt: now,
    expiresAt: now + AGENT_TOKEN_TTL_SECONDS,
  });

  await logMcpCall(db, {
    tokenId,
    userId: owner.id,
    tool: "token.created",
    params: { displayName: AGENT_TOKEN_DISPLAY_NAME },
    success: true,
    message: "System agent token bootstrapped",
  });

  return { tokenId, userId: owner.id, email: owner.email, scope: "read" };
}

// ── Anthropic wire types (raw fetch, no SDK) ─────────────────────────────────

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input?: Record<string, unknown>;
}
interface TextBlock {
  type: "text";
  text: string;
}
type ContentBlock = ToolUseBlock | TextBlock;

interface AnthropicResponse {
  content: ContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

type MessageParam =
  | { role: "user"; content: string | Array<Record<string, unknown>> }
  | { role: "assistant"; content: ContentBlock[] };

// ── The investigation loop ───────────────────────────────────────────────────

async function agentRunsToday(db: Db): Promise<number> {
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(suggestions)
    .where(and(eq(suggestions.feature, "security_agent"), sql`created_at > ${dayAgo}`))
    .get();
  return row?.count ?? 0;
}

/** Decline path: write the same template alert the heuristics used to. */
async function fallbackAlert(db: Db, trigger: SecurityTrigger): Promise<void> {
  const v = fallbackVerdict(trigger);
  await writeSuggestion(db, {
    userId: trigger.talentId,
    category: "action_required",
    title: v.headline,
    body: v.narrative,
    deepLink: trigger.kind === "bridge" ? "/settings/bridge" : "/vault/licences",
    entityType: trigger.kind === "bridge" ? "package" : "licence",
    entityId: trigger.kind === "bridge" ? trigger.packageId : trigger.licenceId,
    priority: 5,
  });
}

async function deliverVerdict(
  db: Db,
  env: SecurityAgentEnv,
  trigger: SecurityTrigger,
  verdict: SecurityVerdict,
  opts: { toolCallCount: number; degraded: boolean }
): Promise<void> {
  const priority = verdict.severity === "critical" ? 1 : verdict.severity === "high" ? 3 : 5;
  const actionsText = verdict.recommended_actions.length
    ? "\n\nRecommended actions (run via MCP — requires your TOTP):\n" +
      verdict.recommended_actions.map((a) => `• ${a.tool} — ${a.reason}`).join("\n")
    : "";

  await writeSuggestion(db, {
    userId: trigger.talentId,
    category: "action_required",
    feature: "security_agent",
    title: verdict.headline,
    body: verdict.narrative + actionsText,
    deepLink: trigger.kind === "bridge" ? "/settings/bridge" : "/vault/licences",
    entityType: trigger.kind === "bridge" ? "package" : "licence",
    entityId: trigger.kind === "bridge" ? trigger.packageId : trigger.licenceId,
    priority,
  });

  const appUrl = env.APP_URL ?? "https://changling.io";
  const { subject, html } = securityAlertEmail({
    severity: verdict.severity,
    headline: verdict.headline,
    narrative: verdict.narrative,
    eventType: trigger.kind === "bridge" ? trigger.eventType : "download_anomaly",
    entityLabel: trigger.kind === "bridge" ? trigger.packageName : trigger.projectName,
    recommendedActions: verdict.recommended_actions,
    toolCallCount: opts.toolCallCount,
    degraded: opts.degraded,
    adminMcpUrl: `${appUrl}/admin/mcp`,
    occurredAt: Math.floor(Date.now() / 1000),
  });
  await sendEmailDirect(env, { to: [...ADMIN_EMAILS], subject, html }, { db });
}

export async function runSecurityInvestigation(
  db: Db,
  env: SecurityAgentEnv,
  trigger: SecurityTrigger
): Promise<void> {
  // Preflight gates — every decline falls back to the template alert.
  if (!(await isAiEnabled(db))) return fallbackAlert(db, trigger);
  if (!(await isFeatureEnabled(db, "security_agent"))) return fallbackAlert(db, trigger);
  if (!env.ANTHROPIC_API_KEY) return fallbackAlert(db, trigger); // tool use needs Anthropic; no Workers-AI fallback
  if ((await checkBudget(db)).exhausted) return fallbackAlert(db, trigger);
  if ((await agentRunsToday(db)) >= AGENT_MAX_RUNS_PER_DAY) return fallbackAlert(db, trigger);
  const token = await getOrCreateAgentToken(db);
  if (!token) return fallbackAlert(db, trigger); // revoked = kill switch

  const tools = mcpToolsToAnthropic();
  const pricing = PRICING[AGENT_MODEL];
  const messages: MessageParam[] = [
    {
      role: "user",
      content:
        "A security trigger fired. Investigate and produce your verdict.\n" +
        "<untrusted_event_data>\n" +
        JSON.stringify(trigger) +
        "\n</untrusted_event_data>",
    },
  ];

  let verdict: SecurityVerdict | null = null;
  let degraded = false;
  let toolCallCount = 0;

  for (let turn = 0; turn <= AGENT_MAX_TOOL_TURNS; turn++) {
    let data: AnthropicResponse;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: AGENT_MODEL,
          max_tokens: AGENT_MAX_TOKENS_PER_CALL,
          system: SECURITY_AGENT_PROMPT,
          tools,
          messages,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        await logAiCost(db, {
          provider: "anthropic",
          model: AGENT_MODEL,
          feature: "security_agent",
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          error: `HTTP ${res.status}: ${errBody.slice(0, 500)}`,
        });
        degraded = true;
        break;
      }
      data = (await res.json()) as AnthropicResponse;
    } catch (err) {
      await logAiCost(db, {
        provider: "anthropic",
        model: AGENT_MODEL,
        feature: "security_agent",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        error: `fetch failed: ${err instanceof Error ? err.message : "unknown"}`,
      });
      degraded = true;
      break;
    }

    const textOut = data.content
      .filter((b): b is TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const lastUser = messages[messages.length - 1];
    await logAiCost(db, {
      provider: "anthropic",
      model: AGENT_MODEL,
      feature: "security_agent",
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      estimatedCostUsd:
        (data.usage?.input_tokens ?? 0) * pricing.input +
        (data.usage?.output_tokens ?? 0) * pricing.output,
      prompt: (typeof lastUser.content === "string" ? lastUser.content : JSON.stringify(lastUser.content)).slice(0, 2000),
      response: textOut.slice(0, 4000),
    });

    if (data.stop_reason !== "tool_use") {
      // end_turn → parse verdict; max_tokens / refusal → degraded fallback
      verdict = data.stop_reason === "end_turn" ? parseVerdict(textOut) : null;
      if (!verdict) degraded = true;
      break;
    }

    if (turn === AGENT_MAX_TOOL_TURNS) {
      degraded = true; // hit the turn cap while the model still wants tools
      break;
    }

    messages.push({ role: "assistant", content: data.content });
    const toolResults: Array<Record<string, unknown>> = [];
    for (const block of data.content) {
      if (block.type !== "tool_use") continue;
      const def = getMcpTool(block.name);
      if (!def || def.mutating) {
        await logMcpCall(db, {
          tokenId: token.tokenId,
          userId: token.userId,
          tool: block.name,
          params: block.input,
          success: false,
          message: "security-agent: tool rejected (unknown or mutating)",
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Tool not available to the security agent.",
          is_error: true,
        });
        continue;
      }
      try {
        const result = await def.execute({ db, token }, block.input ?? {});
        toolCallCount++;
        await logMcpCall(db, {
          tokenId: token.tokenId,
          userId: token.userId,
          tool: block.name,
          params: block.input,
          success: result.success,
          message: `security-agent: ${result.message}`,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result).slice(0, AGENT_MAX_TOOL_RESULT_CHARS),
          is_error: !result.success,
        });
      } catch (err) {
        await logMcpCall(db, {
          tokenId: token.tokenId,
          userId: token.userId,
          tool: block.name,
          params: block.input,
          success: false,
          message: `security-agent: ${String(err).slice(0, 500)}`,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Tool execution failed.",
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });

    if ((await checkBudget(db)).exhausted) {
      degraded = true;
      break;
    }
  }

  await deliverVerdict(db, env, trigger, verdict ?? fallbackVerdict(trigger), {
    toolCallCount,
    degraded,
  });
}
