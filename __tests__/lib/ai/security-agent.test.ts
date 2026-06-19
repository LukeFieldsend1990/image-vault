import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tool modules transitively reference edge-only modules in some paths;
// registry-based tests never execute those paths
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import { mockChainDb } from "../../helpers/mocks";
import {
  mcpToolsToAnthropic,
  parseVerdict,
  fallbackVerdict,
  runSecurityInvestigation,
  AGENT_MAX_TOOL_TURNS,
} from "@/lib/ai/security-agent";
import type { SecurityTrigger } from "@/lib/ai/security-alerts";
import { securityAlertEmail } from "@/lib/email/templates";

const BRIDGE_TRIGGER: SecurityTrigger = {
  kind: "bridge",
  eventType: "tamper_detected",
  severity: "critical",
  deviceId: "device-1234567890",
  packageId: "pkg-1",
  packageName: "Head Scan 2026",
  talentId: "talent-1",
  recentCriticalCount: 2,
};

const TOKEN_ROW = {
  id: "tok-1",
  userId: "admin-1",
  expiresAt: Math.floor(Date.now() / 1000) + 300 * 86400,
  revokedAt: null,
  email: "lukefieldsend@googlemail.com",
};

/** Queue the standard preflight DB results (enabled → token row). */
function enqueuePreflight(enqueue: (v: unknown) => void, tokenRow: unknown = TOKEN_ROW) {
  enqueue({ value: "true" });  // isAiEnabled
  enqueue({ value: "true" });  // isFeatureEnabled(security_agent)
  enqueue({ total: 0 });       // checkBudget: spent
  enqueue({ value: "1.00" });  // checkBudget: ceiling
  enqueue({ count: 0 });       // agentRunsToday
  enqueue(tokenRow);           // getOrCreateAgentToken existing row
}

function anthropicResponse(payload: unknown) {
  return { ok: true, json: async () => payload } as Response;
}

function toolUseResponse(name: string, input: Record<string, unknown> = {}) {
  return anthropicResponse({
    content: [{ type: "tool_use", id: `toolu_${name}_${Math.random().toString(36).slice(2, 8)}`, name, input }],
    stop_reason: "tool_use",
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

function endTurnResponse(text: string) {
  return anthropicResponse({
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

const VALID_VERDICT_JSON = JSON.stringify({
  severity: "critical",
  headline: "Repeated tamper attempts on Head Scan 2026",
  narrative: "Device device-12 produced 2 critical events in 24h targeting the same package.",
  recommended_actions: [{ tool: "set_user_suspended", reason: "Device owner account shows hostile behaviour." }],
});

describe("mcpToolsToAnthropic", () => {
  it("exposes only non-mutating tools in valid Anthropic shape", () => {
    const tools = mcpToolsToAnthropic();
    const names = tools.map((t) => t.name);

    expect(names).toContain("get_security_events");
    expect(names).toContain("get_platform_overview");
    expect(names).toContain("list_concepts");

    for (const forbidden of ["set_user_flag", "set_user_suspended", "set_user_role", "restore_package", "revoke_mcp_token", "invite_user"]) {
      expect(names).not.toContain(forbidden);
    }

    for (const t of tools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.input_schema).toMatchObject({ type: "object" });
    }
  });
});

describe("parseVerdict", () => {
  it("parses a valid verdict and keeps allowlisted mutating actions", () => {
    const v = parseVerdict(VALID_VERDICT_JSON);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe("critical");
    expect(v!.recommended_actions).toHaveLength(1);
    expect(v!.recommended_actions[0].tool).toBe("set_user_suspended");
  });

  it("parses fenced JSON", () => {
    expect(parseVerdict("```json\n" + VALID_VERDICT_JSON + "\n```")).not.toBeNull();
  });

  it("rejects invalid JSON and bad severities", () => {
    expect(parseVerdict("not json at all")).toBeNull();
    expect(parseVerdict(JSON.stringify({ severity: "apocalyptic", headline: "x", narrative: "y" }))).toBeNull();
  });

  it("drops hallucinated and non-mutating recommended tools", () => {
    const v = parseVerdict(
      JSON.stringify({
        severity: "high",
        headline: "h",
        narrative: "n",
        recommended_actions: [
          { tool: "rm_rf_everything", reason: "injected" },
          { tool: "list_users", reason: "read tool, not corrective" },
          { tool: "set_user_flag", reason: "legitimate" },
        ],
      })
    );
    expect(v!.recommended_actions.map((a) => a.tool)).toEqual(["set_user_flag"]);
  });

  it("clamps over-length headline and narrative", () => {
    const v = parseVerdict(
      JSON.stringify({ severity: "medium", headline: "H".repeat(300), narrative: "N".repeat(2000), recommended_actions: [] })
    );
    expect(v!.headline.length).toBeLessThanOrEqual(90);
    expect(v!.narrative.length).toBeLessThanOrEqual(600);
  });
});

describe("runSecurityInvestigation", () => {
  const env = { ANTHROPIC_API_KEY: "test-key" };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("terminates after the turn cap and still delivers a fallback verdict", async () => {
    const { db, enqueue, insertedRows } = mockChainDb();
    enqueuePreflight(enqueue);
    fetchMock.mockImplementation(async () => toolUseResponse("list_concepts"));

    await runSecurityInvestigation(db as never, env, BRIDGE_TRIGGER);

    expect(fetchMock).toHaveBeenCalledTimes(AGENT_MAX_TOOL_TURNS + 1);
    const suggestion = insertedRows.map((r) => r.values as Record<string, unknown>).find((v) => v.feature === "security_agent" && v.category !== undefined);
    expect(suggestion).toBeDefined();
    expect(suggestion!.category).toBe("action_required");
  });

  it("happy path: investigates with tools then delivers the parsed verdict", async () => {
    const { db, enqueue, insertedRows } = mockChainDb();
    enqueuePreflight(enqueue);
    fetchMock
      .mockResolvedValueOnce(toolUseResponse("list_concepts"))
      .mockResolvedValueOnce(toolUseResponse("explain_concept", { id: "security-model" }))
      .mockResolvedValueOnce(endTurnResponse(VALID_VERDICT_JSON));

    await runSecurityInvestigation(db as never, env, BRIDGE_TRIGGER);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const values = insertedRows.map((r) => r.values as Record<string, unknown>);
    const audits = values.filter((v) => typeof v.tool === "string" && v.tokenId === "tok-1");
    expect(audits.map((a) => a.tool)).toEqual(["list_concepts", "explain_concept"]);
    expect(audits.every((a) => a.success === true)).toBe(true);

    const costs = values.filter((v) => v.provider === "anthropic" && v.feature === "security_agent");
    expect(costs).toHaveLength(3);

    const suggestion = values.find((v) => v.feature === "security_agent" && v.category !== undefined);
    expect(suggestion).toBeDefined();
    expect(suggestion!.title).toBe("Repeated tamper attempts on Head Scan 2026");
    expect(String(suggestion!.body)).toContain("set_user_suspended");
  });

  it("rejects mutating tool requests without executing them", async () => {
    const { db, enqueue, insertedRows } = mockChainDb();
    enqueuePreflight(enqueue);
    fetchMock
      .mockResolvedValueOnce(toolUseResponse("set_user_suspended", { email: "victim@example.com", suspended: true }))
      .mockResolvedValueOnce(endTurnResponse(VALID_VERDICT_JSON));

    await runSecurityInvestigation(db as never, env, BRIDGE_TRIGGER);

    const values = insertedRows.map((r) => r.values as Record<string, unknown>);
    const audit = values.find((v) => v.tool === "set_user_suspended");
    expect(audit).toBeDefined();
    expect(audit!.success).toBe(false);
    expect(String(audit!.message)).toContain("rejected");

    // The model is told the tool failed, and no user row was ever updated
    const secondCallBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    const lastMessage = secondCallBody.messages[secondCallBody.messages.length - 1];
    expect(lastMessage.content[0].is_error).toBe(true);
  });

  it("kill switch: a revoked system token disables the agent entirely", async () => {
    const { db, enqueue, insertedRows } = mockChainDb();
    enqueuePreflight(enqueue, { ...TOKEN_ROW, revokedAt: 1781200000 });

    await runSecurityInvestigation(db as never, env, BRIDGE_TRIGGER);

    expect(fetchMock).not.toHaveBeenCalled();
    const suggestion = insertedRows.map((r) => r.values as Record<string, unknown>).find((v) => v.feature === "security_alert" && v.category !== undefined);
    expect(suggestion).toBeDefined(); // template fallback alert still filed
    expect(suggestion!.category).toBe("action_required");
  });

  it("stops early when the budget exhausts mid-loop", async () => {
    const { db, enqueue, insertedRows } = mockChainDb();
    enqueuePreflight(enqueue);
    enqueue({ total: 5 });      // mid-loop checkBudget: spent
    enqueue({ value: "1.00" }); // mid-loop checkBudget: ceiling → exhausted
    fetchMock.mockImplementation(async () => toolUseResponse("list_concepts"));

    await runSecurityInvestigation(db as never, env, BRIDGE_TRIGGER);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const suggestion = insertedRows.map((r) => r.values as Record<string, unknown>).find((v) => v.feature === "security_agent" && v.category !== undefined);
    expect(suggestion).toBeDefined();
  });
});

describe("securityAlertEmail", () => {
  it("escapes untrusted verdict content and includes severity in the subject", () => {
    const { subject, html } = securityAlertEmail({
      severity: "critical",
      headline: `<script>alert("xss")</script>`,
      narrative: `Narrative with <img src=x onerror=alert(1)> attempt`,
      eventType: "tamper_detected",
      entityLabel: "Head Scan <2026>",
      recommendedActions: [{ tool: "set_user_suspended", reason: `Because <b>reasons</b>` }],
      toolCallCount: 3,
      adminMcpUrl: "https://changling.io/admin/mcp",
      occurredAt: Math.floor(Date.now() / 1000),
    });
    expect(subject).toContain("CRITICAL");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>reasons</b>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("fallbackVerdict", () => {
  it("produces a deliverable verdict for both trigger kinds", () => {
    const bridge = fallbackVerdict(BRIDGE_TRIGGER);
    expect(bridge.severity).toBe("high");
    expect(bridge.headline).toContain("tamper detected");

    const download = fallbackVerdict({
      kind: "download",
      licenceId: "lic-1",
      licenseeId: "lcs-1",
      ip: "1.2.3.4",
      downloads24h: 12,
      knownIpCount: 2,
      talentId: "talent-1",
      projectName: "Project X",
    });
    expect(download.headline).toContain("Project X");
    expect(download.narrative).toContain("12");
  });
});
