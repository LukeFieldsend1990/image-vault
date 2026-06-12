export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { mcpTokens, totpCredentials, users } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { verifyTotpCode } from "@/lib/auth/totp";
import { checkRateLimit, getClientIp } from "@/lib/auth/rateLimit";
import { logMcpCall } from "@/lib/mcp/audit";

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateToken(): string {
  // 32 bytes → 64 hex chars, prefixed for clarity
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "mcp_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

const DEFAULT_EXPIRY_DAYS = 30;
const MAX_EXPIRY_DAYS = 90;

// GET /api/mcp/tokens — list all MCP tokens (admin only; tokens are admin-owned)
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const tokens = await db
    .select({
      id: mcpTokens.id,
      displayName: mcpTokens.displayName,
      scope: mcpTokens.scope,
      createdAt: mcpTokens.createdAt,
      expiresAt: mcpTokens.expiresAt,
      lastUsedAt: mcpTokens.lastUsedAt,
      revokedAt: mcpTokens.revokedAt,
      ownerEmail: users.email,
    })
    .from(mcpTokens)
    .innerJoin(users, eq(users.id, mcpTokens.userId))
    .orderBy(desc(mcpTokens.createdAt))
    .all();

  return NextResponse.json({ tokens });
}

// POST /api/mcp/tokens — mint a new MCP token.
// Requires an admin session AND a fresh TOTP code: possession of a session
// cookie alone is not enough to create standing API access.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = getClientIp(req);
  const limit = await checkRateLimit(ip, { action: "mcp_token_mint", maxAttempts: 5, windowSeconds: 300 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: { displayName?: string; scope?: string; totpCode?: string; expiresInDays?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const displayName = (body.displayName ?? "").trim();
  if (!displayName) return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  if (displayName.length > 80) return NextResponse.json({ error: "displayName too long" }, { status: 400 });

  const scope = body.scope === "admin" ? "admin" : "read";

  const expiresInDays = Math.min(
    Math.max(Math.floor(body.expiresInDays ?? DEFAULT_EXPIRY_DAYS), 1),
    MAX_EXPIRY_DAYS
  );

  const db = getDb();
  const totp = await db
    .select({ secret: totpCredentials.secret })
    .from(totpCredentials)
    .where(and(eq(totpCredentials.userId, session.sub), eq(totpCredentials.verified, true)))
    .get();
  if (!totp) {
    return NextResponse.json({ error: "2FA is not enrolled on this account" }, { status: 400 });
  }
  if (!body.totpCode || !verifyTotpCode(totp.secret, body.totpCode)) {
    return NextResponse.json({ error: "Invalid TOTP code" }, { status: 401 });
  }

  const rawToken = generateToken();
  const tokenHash = await sha256Hex(rawToken);
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();

  await db.insert(mcpTokens).values({
    id,
    userId: session.sub,
    tokenHash,
    displayName,
    scope,
    createdAt: now,
    expiresAt: now + expiresInDays * 24 * 60 * 60,
  });

  await logMcpCall(db, {
    tokenId: id,
    userId: session.sub,
    tool: "token.created",
    params: { displayName, scope, expiresInDays },
    success: true,
    message: `MCP token "${displayName}" (${scope}) created, expires in ${expiresInDays}d.`,
  });

  // Return the raw token once — it cannot be retrieved again
  return NextResponse.json(
    { token: rawToken, id, displayName, scope, expiresAt: now + expiresInDays * 24 * 60 * 60 },
    { status: 201 }
  );
}
