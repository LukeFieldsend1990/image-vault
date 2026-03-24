export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { bridgeDevices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  requireBridgeToken,
  isBridgeTokenError,
} from "@/lib/auth/requireBridgeToken";

function uuid(): string {
  return crypto.randomUUID();
}

// GET /api/bridge/devices — list devices registered by the caller's user account
export async function GET(req: NextRequest) {
  const auth = await requireBridgeToken(req);
  if (isBridgeTokenError(auth)) return auth;

  const db = getDb();
  const devices = await db
    .select({
      id: bridgeDevices.id,
      fingerprint: bridgeDevices.fingerprint,
      displayName: bridgeDevices.displayName,
      lastSeenAt: bridgeDevices.lastSeenAt,
      createdAt: bridgeDevices.createdAt,
    })
    .from(bridgeDevices)
    .where(eq(bridgeDevices.userId, auth.userId))
    .all();

  return NextResponse.json({ devices });
}

// POST /api/bridge/devices — register (or update) a device by fingerprint
export async function POST(req: NextRequest) {
  const auth = await requireBridgeToken(req);
  if (isBridgeTokenError(auth)) return auth;

  let body: { fingerprint?: string; displayName?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fingerprint = (body.fingerprint ?? "").trim();
  const displayName = (body.displayName ?? "").trim();

  if (!fingerprint) {
    return NextResponse.json({ error: "fingerprint is required" }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Upsert: if device with this fingerprint already exists for this user, update lastSeenAt
  const existing = await db
    .select({ id: bridgeDevices.id })
    .from(bridgeDevices)
    .where(eq(bridgeDevices.fingerprint, fingerprint))
    .get();

  if (existing) {
    await db
      .update(bridgeDevices)
      .set({ displayName, lastSeenAt: now })
      .where(eq(bridgeDevices.id, existing.id))
      .run();
    return NextResponse.json({ id: existing.id, registered: false });
  }

  const id = uuid();
  await db.insert(bridgeDevices).values({
    id,
    userId: auth.userId,
    fingerprint,
    displayName,
    createdAt: now,
    lastSeenAt: now,
  });

  return NextResponse.json({ id, registered: true }, { status: 201 });
}
