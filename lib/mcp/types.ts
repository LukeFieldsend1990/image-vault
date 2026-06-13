/**
 * Admin MCP tool system types.
 * Mirrors the lib/skills/ pattern: each tool is a self-describing, typed
 * definition registered in an in-memory registry. Tools are exposed to MCP
 * clients (Claude) over the Streamable HTTP endpoint at /api/mcp.
 */

import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface McpTokenPayload {
  tokenId: string;
  userId: string;
  email: string;
  scope: "read" | "admin";
}

export interface McpToolContext {
  db: Db;
  token: McpTokenPayload;
}

export interface McpToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/** JSON Schema subset used for tool inputs (manual validation, no Zod). */
export interface McpInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpInputSchema;
  /**
   * Mutating tools change platform state. The dispatcher enforces two extra
   * gates on them: the token must have "admin" scope, and every call must
   * carry a fresh 6-digit TOTP code (verified against the admin's enrolled
   * authenticator) — the MCP equivalent of the platform's dual-custody rule.
   */
  mutating: boolean;
  execute: (ctx: McpToolContext, params: Record<string, unknown>) => Promise<McpToolResult>;
}
