import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { mcpTokens, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isAdmin } from "./adminEmails";
import type { McpTokenPayload } from "@/lib/mcp/types";

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validates `Authorization: Bearer mcp_…` against the mcp_tokens table.
 *
 * Beyond the bridge-token checks (hash match, not revoked), MCP tokens also
 * expire and the owner must still be on the admin whitelist and unsuspended —
 * re-checked on every request, so removing an email from adminEmails.ts
 * immediately invalidates all of that admin's tokens.
 */
export async function requireMcpToken(
  req: NextRequest
): Promise<McpTokenPayload | NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing MCP token" }, { status: 401 });
  }

  const rawToken = auth.slice(7).trim();
  if (!rawToken.startsWith("mcp_")) {
    return NextResponse.json({ error: "Invalid MCP token" }, { status: 401 });
  }

  const tokenHash = await sha256Hex(rawToken);
  const db = getDb();

  const row = await db
    .select({
      id: mcpTokens.id,
      userId: mcpTokens.userId,
      scope: mcpTokens.scope,
      expiresAt: mcpTokens.expiresAt,
      revokedAt: mcpTokens.revokedAt,
      email: users.email,
      suspendedAt: users.suspendedAt,
    })
    .from(mcpTokens)
    .innerJoin(users, eq(users.id, mcpTokens.userId))
    .where(eq(mcpTokens.tokenHash, tokenHash))
    .get();

  const now = Math.floor(Date.now() / 1000);
  if (!row || row.revokedAt !== null) {
    return NextResponse.json({ error: "Invalid or revoked MCP token" }, { status: 401 });
  }
  if (row.expiresAt <= now) {
    return NextResponse.json({ error: "Expired MCP token" }, { status: 401 });
  }
  if (row.suspendedAt !== null || !isAdmin(row.email)) {
    return NextResponse.json({ error: "Token owner is not an active admin" }, { status: 403 });
  }

  // Update lastUsedAt (fire-and-forget, don't await)
  void db
    .update(mcpTokens)
    .set({ lastUsedAt: now })
    .where(eq(mcpTokens.id, row.id))
    .run();

  return {
    tokenId: row.id,
    userId: row.userId,
    email: row.email,
    scope: row.scope,
  };
}

export function isMcpTokenError(
  result: McpTokenPayload | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
