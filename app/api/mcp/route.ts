/**
 * Admin MCP server — Streamable HTTP transport (stateless, JSON responses).
 *
 * Speaks MCP JSON-RPC 2.0: initialize, ping, tools/list, tools/call.
 * Auth: Bearer mcp_ token (see lib/auth/requireMcpToken.ts). Mutating tools
 * additionally require an admin-scope token and a fresh per-call TOTP code.
 * Every tool call is rate-limited and written to mcp_audit_log.
 *
 * Connect from Claude Code:
 *   claude mcp add --transport http image-vault https://imagevault.ai/api/mcp \
 *     --header "Authorization: Bearer mcp_…"
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { totpCredentials } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireMcpToken, isMcpTokenError } from "@/lib/auth/requireMcpToken";
import { verifyTotpCode } from "@/lib/auth/totp";
import { checkRateLimit } from "@/lib/auth/rateLimit";
import { getMcpTool, getAllMcpTools } from "@/lib/mcp/registry";
import { logMcpCall } from "@/lib/mcp/audit";
import type { McpTokenPayload, McpToolResult } from "@/lib/mcp/types";
import "@/lib/mcp/tools";

// 2025-06-18 requires SSE GET support (server-initiated messages); our stateless
// server doesn't implement SSE, so we cap at 2025-03-26 to avoid the client
// attempting SSE-mode reconnects that return an empty 404.
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "image-vault-admin", version: "1.0.0" };

const SERVER_INSTRUCTIONS =
  "Image Vault admin MCP server. Image Vault is a secure biometric likeness archive for actors: " +
  "talent stores scan packages and licenses access to production companies via dual-custody 2FA download. " +
  "Call list_concepts / explain_concept first to orient yourself, and get_platform_overview for current state. " +
  "Read tools are safe; mutating tools (marked MUTATING in their descriptions, e.g. user changes, invites, " +
  "productions, licence requests) require an admin-scope token and a fresh 6-digit TOTP code in the totp_code " +
  "argument — ask the admin for the code from their authenticator app at the moment of the call; codes are " +
  "single-window and never stored. " +
  "Admin accounts themselves can never be modified through this integration.";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** tools/list entry: mutating tools get totp_code appended to their schema. */
function toolDescriptor(tool: ReturnType<typeof getAllMcpTools>[number]) {
  if (!tool.mutating) {
    return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
  }
  return {
    name: tool.name,
    description: `${tool.description} MUTATING: requires admin-scope token and a fresh 6-digit TOTP code (totp_code).`,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...tool.inputSchema.properties,
        totp_code: {
          type: "string",
          description: "Fresh 6-digit TOTP code from the admin's authenticator app (verified per call, never stored)",
        },
      },
      required: [...(tool.inputSchema.required ?? []), "totp_code"],
    },
  };
}

async function handleToolCall(
  token: McpTokenPayload,
  id: string | number | null,
  params: Record<string, unknown> | undefined
) {
  const name = typeof params?.name === "string" ? params.name : "";
  const args = (params?.arguments ?? {}) as Record<string, unknown>;
  const tool = getMcpTool(name);
  if (!tool) {
    return rpcError(id, -32602, `Unknown tool "${name}".`);
  }

  const db = getDb();

  // Dual gate for mutating tools: admin scope + fresh TOTP code per call.
  if (tool.mutating) {
    if (token.scope !== "admin") {
      const message = "This tool mutates platform state and requires an admin-scope MCP token (yours is read-only).";
      await logMcpCall(db, { tokenId: token.tokenId, userId: token.userId, tool: name, params: args, success: false, message });
      return rpcResult(id, { content: [{ type: "text", text: message }], isError: true });
    }

    const totpLimit = await checkRateLimit(token.tokenId, {
      action: "mcp_totp",
      maxAttempts: 5,
      windowSeconds: 300,
    });
    if (!totpLimit.ok) {
      return rpcResult(id, {
        content: [{ type: "text", text: `Too many TOTP attempts. Retry in ${totpLimit.retryAfterSeconds}s.` }],
        isError: true,
      });
    }

    const code = typeof args.totp_code === "string" ? args.totp_code : "";
    const totp = await db
      .select({ secret: totpCredentials.secret })
      .from(totpCredentials)
      .where(and(eq(totpCredentials.userId, token.userId), eq(totpCredentials.verified, true)))
      .get();
    if (!totp || !code || !verifyTotpCode(totp.secret, code)) {
      const message = "Invalid or missing TOTP code. Provide a fresh 6-digit code from the authenticator app in totp_code.";
      await logMcpCall(db, { tokenId: token.tokenId, userId: token.userId, tool: name, params: args, success: false, message });
      return rpcResult(id, { content: [{ type: "text", text: message }], isError: true });
    }
    delete args.totp_code; // never pass the code into tool handlers
  }

  let result: McpToolResult;
  try {
    result = await tool.execute({ db, token, kv: getKv() }, args);
  } catch (err) {
    result = { success: false, message: `Tool failed: ${err instanceof Error ? err.message : "unknown error"}` };
  }

  await logMcpCall(db, {
    tokenId: token.tokenId,
    userId: token.userId,
    tool: name,
    params: args,
    success: result.success,
    message: result.message,
  });

  const text = result.data !== undefined
    ? `${result.message}\n\n${JSON.stringify(result.data, null, 2)}`
    : result.message;

  return rpcResult(id, {
    content: [{ type: "text", text }],
    ...(result.data !== undefined ? { structuredContent: { result: result.data } } : {}),
    isError: !result.success,
  });
}

async function dispatch(token: McpTokenPayload, msg: JsonRpcRequest): Promise<object | null> {
  const id = msg.id ?? null;

  // Notifications carry no id and get no response
  if (msg.method?.startsWith("notifications/")) return null;

  switch (msg.method) {
    case "initialize": {
      const requested = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[1];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: getAllMcpTools().map(toolDescriptor) });
    case "tools/call":
      return handleToolCall(token, id, msg.params);
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method ?? "(none)"}`);
  }
}

export async function POST(req: NextRequest) {
  const token = await requireMcpToken(req);
  if (isMcpTokenError(token)) return token;

  const limit = await checkRateLimit(token.tokenId, {
    action: "mcp_rpc",
    maxAttempts: 120,
    windowSeconds: 60,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const messages: JsonRpcRequest[] = Array.isArray(body) ? body : [body as JsonRpcRequest];
  if (messages.length === 0 || messages.length > 20) {
    return NextResponse.json(rpcError(null, -32600, "Invalid request batch"), { status: 400 });
  }

  const responses: object[] = [];
  for (const msg of messages) {
    const res = await dispatch(token, msg);
    if (res !== null) responses.push(res);
  }

  // All-notification input gets 202 with no body, per Streamable HTTP spec
  if (responses.length === 0) return new NextResponse(null, { status: 202 });

  return NextResponse.json(Array.isArray(body) ? responses : responses[0]);
}

// Stateless server: no SSE stream, no sessions. Explicit Allow header prevents
// Cloudflare edge from converting 405 into a 404 on some CDN paths.
export function GET() {
  return NextResponse.json(
    { error: "This MCP server does not support SSE. POST JSON-RPC messages instead." },
    { status: 405, headers: { Allow: "POST" } }
  );
}

export function DELETE() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
}
