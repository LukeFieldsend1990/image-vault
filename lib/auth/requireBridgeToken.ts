import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { bridgeTokens, users } from "@/lib/db/schema";
import { eq, isNull } from "drizzle-orm";
import { createHash } from "crypto";

export interface BridgeTokenPayload {
  tokenId: string;
  userId: string;
  role: string;
  email: string;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Validates `Authorization: Bearer <token>` against bridge_tokens table.
 * Returns the token payload or a 401 NextResponse.
 */
export async function requireBridgeToken(
  req: NextRequest
): Promise<BridgeTokenPayload | NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bridge token" }, { status: 401 });
  }

  const rawToken = auth.slice(7).trim();
  if (!rawToken) {
    return NextResponse.json({ error: "Missing bridge token" }, { status: 401 });
  }

  const tokenHash = sha256Hex(rawToken);
  const db = getDb();

  const row = await db
    .select({
      id: bridgeTokens.id,
      userId: bridgeTokens.userId,
      revokedAt: bridgeTokens.revokedAt,
      role: users.role,
      email: users.email,
    })
    .from(bridgeTokens)
    .innerJoin(users, eq(users.id, bridgeTokens.userId))
    .where(eq(bridgeTokens.tokenHash, tokenHash))
    .get();

  if (!row || row.revokedAt !== null) {
    return NextResponse.json({ error: "Invalid or revoked bridge token" }, { status: 401 });
  }

  // Update lastUsedAt (fire-and-forget, don't await)
  const now = Math.floor(Date.now() / 1000);
  void db
    .update(bridgeTokens)
    .set({ lastUsedAt: now })
    .where(eq(bridgeTokens.id, row.id))
    .run();

  return {
    tokenId: row.id,
    userId: row.userId,
    role: row.role,
    email: row.email,
  };
}

export function isBridgeTokenError(
  result: BridgeTokenPayload | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
