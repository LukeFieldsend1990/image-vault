import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { mcpAuditLog, aiSettings, suggestions, mcpTokens } from "@/lib/db/schema";
import { desc, sql, eq, and, gte } from "drizzle-orm";
import { getAllMcpTools } from "@/lib/mcp/registry";
import "@/lib/mcp/tools";
import McpClient from "./mcp-client";

// Matches AGENT_TOKEN_DISPLAY_NAME in lib/ai/security-agent.ts. Hardcoded so
// this Next page doesn't pull the agent (ai-worker) module into its bundle.
const AGENT_TOKEN_NAME = "system: security-agent";
const SEVEN_DAYS = 7 * 24 * 60 * 60;

function fmtWhen(ts: number | null): string {
  if (!ts) return "never";
  return new Date(ts * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default async function AdminMcpPage() {
  await requireAdmin();

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const since = now - SEVEN_DAYS;

  const [auditRows, agentSetting, masterSetting, runStats, agentToken] = await Promise.all([
    db
      .select({
        id: mcpAuditLog.id,
        tool: mcpAuditLog.tool,
        success: mcpAuditLog.success,
        message: mcpAuditLog.message,
        userEmail: sql<string>`(SELECT email FROM users WHERE id = ${mcpAuditLog.userId})`,
        createdAt: mcpAuditLog.createdAt,
      })
      .from(mcpAuditLog)
      .orderBy(desc(mcpAuditLog.createdAt))
      .limit(50)
      .all(),
    db.select({ value: aiSettings.value }).from(aiSettings).where(eq(aiSettings.key, "security_agent_enabled")).get(),
    db.select({ value: aiSettings.value }).from(aiSettings).where(eq(aiSettings.key, "enabled")).get(),
    db
      .select({ count: sql<number>`count(*)`, last: sql<number | null>`max(created_at)` })
      .from(suggestions)
      .where(and(eq(suggestions.feature, "security_agent"), gte(suggestions.createdAt, since)))
      .get(),
    db
      .select({ revokedAt: mcpTokens.revokedAt, expiresAt: mcpTokens.expiresAt })
      .from(mcpTokens)
      .where(eq(mcpTokens.displayName, AGENT_TOKEN_NAME))
      .orderBy(desc(mcpTokens.createdAt))
      .limit(1)
      .get(),
  ]);

  const masterEnabled = masterSetting?.value === "true";
  const flagEnabled = agentSetting?.value === "true";
  const tokenRevoked = !!agentToken && agentToken.revokedAt !== null;

  // Effective status: the flag alone isn't enough — the master AI switch and the
  // system-token kill-switch both gate the agent.
  let status: "active" | "disabled" | "blocked";
  let statusReason: string;
  if (!masterEnabled) {
    status = "disabled";
    statusReason = "AI is turned off globally";
  } else if (!flagEnabled) {
    status = "disabled";
    statusReason = "Toggle is off";
  } else if (tokenRevoked) {
    status = "blocked";
    statusReason = "System token revoked — re-enable by clearing the revocation";
  } else {
    status = "active";
    statusReason = agentToken ? "Investigating critical events" : "Enabled — token is created on first event";
  }

  const statusColor = status === "active" ? "#166534" : status === "blocked" ? "#c0392b" : "var(--color-muted)";
  const statusLabel = status === "active" ? "Active" : status === "blocked" ? "Blocked" : "Disabled";

  const tools = getAllMcpTools().map((t) => ({
    name: t.name,
    description: t.description,
    mutating: t.mutating,
  }));

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <p
          className="text-[10px] uppercase tracking-widest font-semibold mb-1"
          style={{ color: "var(--color-accent)" }}
        >
          Admin
        </p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
          MCP Integration
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Connect Claude to the platform via the MCP server at <code>/api/mcp</code>.
          Tokens require a fresh 2FA code to mint; mutating tools require a fresh 2FA code per call.
        </p>
      </div>
      {/* Security agent status */}
      <div
        className="rounded p-4 mb-8"
        style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-block rounded-full"
              style={{ width: 8, height: 8, background: statusColor }}
            />
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                Security Agent — {statusLabel}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                {statusReason}. {runStats?.count ?? 0} investigation{(runStats?.count ?? 0) !== 1 ? "s" : ""} in the last 7 days
                {runStats?.count ? ` · last ${fmtWhen(runStats.last ?? null)}` : ""}.
              </p>
            </div>
          </div>
          <Link
            href="/admin/ai"
            className="text-xs whitespace-nowrap rounded px-3 py-1.5"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}
          >
            {flagEnabled ? "Manage" : "Turn on"} →
          </Link>
        </div>
      </div>

      <McpClient tools={tools} audit={auditRows} />
    </div>
  );
}
