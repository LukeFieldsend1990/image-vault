export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { renderBridgeAgents, bridgeEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { ADMIN_EMAILS } from "@/lib/auth/adminEmails";
import {
  requireRenderBridgeToken,
  isRenderBridgeTokenError,
} from "@/lib/auth/requireRenderBridgeToken";

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateServiceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return `svc_${hex}`;
}

/**
 * POST /api/bridge/render-bridge/:agentId/heartbeat
 *
 * Sent every ~30s by the agent. Updates lastHeartbeatAt and publishedPackages.
 * Returns any pending action (purge | publish | rotate-token | null).
 * Pending action is cleared from DB after being returned once.
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

  let body: { status?: string; publishedPackages?: string[]; version?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const agent = await db
    .select({
      pendingAction: renderBridgeAgents.pendingAction,
      lastHeartbeatAt: renderBridgeAgents.lastHeartbeatAt,
      displayName: renderBridgeAgents.displayName,
    })
    .from(renderBridgeAgents)
    .where(eq(renderBridgeAgents.id, agentId))
    .get();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const ONLINE_THRESHOLD_SECS = 60;
  const wasOffline = agent.lastHeartbeatAt === null
    || agent.lastHeartbeatAt < now - ONLINE_THRESHOLD_SECS;
  const offlineDurationSecs = wasOffline && agent.lastHeartbeatAt !== null
    ? now - agent.lastHeartbeatAt
    : null;

  const action = agent.pendingAction ?? null;
  const publishedPackagesJson = JSON.stringify(body.publishedPackages ?? []);
  const revisionUpdate = typeof body.version === "string" && body.version.length > 0
    ? { buildRevision: body.version }
    : {};

  let newToken: string | null = null;

  if (action === "rotate-token") {
    const rawToken = generateServiceToken();
    const tokenHash = await sha256Hex(rawToken);
    const tokenExpiresAt = now + 365 * 86400;
    await db
      .update(renderBridgeAgents)
      .set({ lastHeartbeatAt: now, publishedPackagesJson, serviceTokenHash: tokenHash, tokenExpiresAt, pendingAction: null, ...revisionUpdate })
      .where(eq(renderBridgeAgents.id, agentId));
    newToken = rawToken;
  } else {
    await db
      .update(renderBridgeAgents)
      .set({ lastHeartbeatAt: now, publishedPackagesJson, pendingAction: null, ...revisionUpdate })
      .where(eq(renderBridgeAgents.id, agentId));
  }

  if (wasOffline) {
    const firstHeartbeat = agent.lastHeartbeatAt === null;
    void (async () => {
      await db.insert(bridgeEvents).values({
        id: crypto.randomUUID(),
        grantId: null,
        packageId: null,
        deviceId: agentId,
        userId: null,
        eventType: "agent_online",
        severity: firstHeartbeat ? "info" : "warn",
        detail: JSON.stringify(
          firstHeartbeat
            ? { firstHeartbeat: true }
            : { offlineSince: agent.lastHeartbeatAt, offlineDurationSecs }
        ),
        createdAt: now,
      });

      if (!firstHeartbeat && offlineDurationSecs !== null && offlineDurationSecs > 300) {
        const mins = Math.round(offlineDurationSecs / 60);
        const durationStr = offlineDurationSecs >= 3600
          ? `${Math.floor(offlineDurationSecs / 3600)}h ${Math.round((offlineDurationSecs % 3600) / 60)}m`
          : `${mins}m`;
        await sendEmail({
          to: [...ADMIN_EMAILS],
          subject: `Render bridge back online: ${agent.displayName}`,
          html: `<p>Render bridge agent <strong>${agent.displayName}</strong> has come back online after being offline for <strong>${durationStr}</strong>.</p><p style="color:#6b7280;font-size:12px">Agent ID: ${agentId}</p>`,
        });
      }
    })();
  }

  return NextResponse.json({ ok: true, action, newToken });
}
