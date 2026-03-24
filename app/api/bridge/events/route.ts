export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { bridgeEvents, bridgeGrants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  requireBridgeToken,
  isBridgeTokenError,
} from "@/lib/auth/requireBridgeToken";

const ALLOWED_EVENT_TYPES = new Set([
  "tamper_detected",
  "unexpected_copy",
  "hash_mismatch",
  "lease_expired",
  "cache_purged",
  "open_denied",
]);

const ALLOWED_SEVERITIES = new Set(["info", "warn", "critical"]);

/**
 * POST /api/bridge/events
 *
 * PAT-authenticated. Called by the CAS Bridge desktop app to report
 * integrity events (tamper alerts, hash mismatches, unexpected file copies, etc.).
 *
 * Body:
 *   grantId?  string  — the grant this event relates to (optional)
 *   packageId string
 *   deviceId  string
 *   eventType string  — tamper_detected | unexpected_copy | hash_mismatch |
 *                       lease_expired | cache_purged | open_denied
 *   severity? string  — info | warn | critical  (default: warn)
 *   detail?   unknown — any JSON-serialisable context
 */
export async function POST(req: NextRequest) {
  const auth = await requireBridgeToken(req);
  if (isBridgeTokenError(auth)) return auth;

  let body: {
    grantId?: string;
    packageId?: string;
    deviceId?: string;
    eventType?: string;
    severity?: string;
    detail?: unknown;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { grantId, packageId, deviceId, eventType, detail } = body;
  const severity = ALLOWED_SEVERITIES.has(body.severity ?? "") ? body.severity! : "warn";

  if (!packageId || !deviceId || !eventType) {
    return NextResponse.json(
      { error: "packageId, deviceId, and eventType are required" },
      { status: 400 }
    );
  }
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    return NextResponse.json(
      { error: `Unknown eventType '${eventType}'` },
      { status: 400 }
    );
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // If grantId provided, verify it belongs to this user
  if (grantId) {
    const grant = await db
      .select({ userId: bridgeGrants.userId })
      .from(bridgeGrants)
      .where(eq(bridgeGrants.id, grantId))
      .get();

    if (!grant || grant.userId !== auth.userId) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }
  }

  await db.insert(bridgeEvents).values({
    id: crypto.randomUUID(),
    grantId: grantId ?? null,
    packageId,
    deviceId,
    userId: auth.userId,
    eventType,
    severity,
    detail: detail !== undefined ? JSON.stringify(detail) : null,
    createdAt: now,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
