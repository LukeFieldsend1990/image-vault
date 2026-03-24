export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { bridgeTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { createHash, randomBytes } from "crypto";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function generateToken(): string {
  // 32 bytes → 64 hex chars, prefixed for clarity
  return "brt_" + randomBytes(32).toString("hex");
}

function uuid(): string {
  return crypto.randomUUID();
}

// GET /api/bridge/tokens — list caller's bridge tokens
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const tokens = await db
    .select({
      id: bridgeTokens.id,
      displayName: bridgeTokens.displayName,
      lastUsedAt: bridgeTokens.lastUsedAt,
      createdAt: bridgeTokens.createdAt,
      revokedAt: bridgeTokens.revokedAt,
    })
    .from(bridgeTokens)
    .where(eq(bridgeTokens.userId, session.sub))
    .all();

  return NextResponse.json({ tokens });
}

// POST /api/bridge/tokens — create a new bridge token
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let displayName: string;
  try {
    const body = await req.json() as { displayName?: string };
    displayName = (body.displayName ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!displayName) {
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }
  if (displayName.length > 80) {
    return NextResponse.json({ error: "displayName too long" }, { status: 400 });
  }

  const rawToken = generateToken();
  const tokenHash = sha256Hex(rawToken);
  const now = Math.floor(Date.now() / 1000);

  const db = getDb();
  await db.insert(bridgeTokens).values({
    id: uuid(),
    userId: session.sub,
    tokenHash,
    displayName,
    createdAt: now,
  });

  // Return the raw token once — it cannot be retrieved again
  return NextResponse.json({ token: rawToken, displayName }, { status: 201 });
}
