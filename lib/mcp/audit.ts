/**
 * Audit logging for MCP activity. Every tool call and token lifecycle event
 * is recorded in mcp_audit_log. Secrets (TOTP codes, tokens) are redacted
 * before parameters are serialised.
 */

import { mcpAuditLog } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

const REDACTED_KEYS = /(totp|code|secret|token|password)/i;

export function redactParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = REDACTED_KEYS.test(key) ? "[redacted]" : value;
  }
  return out;
}

export async function logMcpCall(
  db: Db,
  entry: {
    tokenId: string;
    userId: string;
    tool: string;
    params?: Record<string, unknown>;
    success: boolean;
    message?: string;
  }
): Promise<void> {
  try {
    await db.insert(mcpAuditLog).values({
      id: crypto.randomUUID(),
      tokenId: entry.tokenId,
      userId: entry.userId,
      tool: entry.tool,
      paramsJson: entry.params ? JSON.stringify(redactParams(entry.params)) : null,
      success: entry.success,
      message: entry.message?.slice(0, 500) ?? null,
      createdAt: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    // Audit failures must never break the request itself
    console.warn("mcp audit log write failed", err);
  }
}
