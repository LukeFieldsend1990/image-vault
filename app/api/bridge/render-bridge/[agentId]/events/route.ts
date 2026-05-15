export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { bridgeEvents, renderBridgeAgents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  requireRenderBridgeToken,
  isRenderBridgeTokenError,
} from "@/lib/auth/requireRenderBridgeToken";
import { triggerAiService } from "@/lib/ai/service";
import { getRequestContext } from "@cloudflare/next-on-pages";

const ALLOWED_EVENT_TYPES = new Set([
  "tamper_detected",
  "unexpected_copy",
  "hash_mismatch",
  "cache_purged",
  "purge_started",
  "purge_partial",
  "purge_stalled",
  "purge_failed",
  "file_in_use",
  "file_removed_from_cache",
  "re_access_denied",
]);

const ALLOWED_SEVERITIES = new Set(["info", "warn", "critical"]);

/**
 * POST /api/bridge/render-bridge/:agentId/events
 *
 * Service-token authenticated. Called by the render bridge Docker agent to
 * report integrity and lifecycle events (purge progress, tamper detection, etc.).
 *
 * Body:
 *   packageId string  — platform package UUID
 *   eventType string  — see ALLOWED_EVENT_TYPES
 *   severity? string  — info | warn | critical  (default: warn)
 *   detail?   unknown — JSON-serialisable context
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const auth = await requireRenderBridgeToken(req);
  if (isRenderBridgeTokenError(auth)) return auth;

  const { agentId } = await params;
  if (auth.agentId !== agentId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    packageId?: string;
    eventType?: string;
    severity?: string;
    detail?: unknown;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { packageId, eventType, detail } = body;
  const severity = ALLOWED_SEVERITIES.has(body.severity ?? "") ? body.severity! : "warn";

  if (!packageId || !eventType) {
    return NextResponse.json(
      { error: "packageId and eventType are required" },
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

  const agent = await db
    .select({ id: renderBridgeAgents.id, revokedAt: renderBridgeAgents.revokedAt })
    .from(renderBridgeAgents)
    .where(eq(renderBridgeAgents.id, agentId))
    .get();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  if (agent.revokedAt !== null) {
    return NextResponse.json({ error: "Agent is revoked" }, { status: 403 });
  }

  await db.insert(bridgeEvents).values({
    id: crypto.randomUUID(),
    grantId: null,
    packageId,
    deviceId: agentId,
    userId: null,
    eventType,
    severity,
    detail: detail !== undefined ? JSON.stringify(detail) : null,
    createdAt: now,
  });

  const { ctx } = getRequestContext();
  ctx.waitUntil(
    triggerAiService(req, "/security/bridge-event", {
      method: "POST",
      contentType: "application/json",
      headers: { "x-ai-source": "render-bridge-events" },
      body: JSON.stringify({ packageId, deviceId: agentId, eventType, severity }),
    }).catch(() => {
      // non-fatal
    })
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}
