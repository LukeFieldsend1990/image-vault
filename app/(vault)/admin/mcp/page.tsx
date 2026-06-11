export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { mcpAuditLog } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";
import { getAllMcpTools } from "@/lib/mcp/registry";
import "@/lib/mcp/tools";
import McpClient from "./mcp-client";

export default async function AdminMcpPage() {
  await requireAdmin();

  const db = getDb();
  const auditRows = await db
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
    .all();

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
      <McpClient tools={tools} audit={auditRows} />
    </div>
  );
}
