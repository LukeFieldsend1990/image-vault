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

/**
 * POST /api/bridge/render-bridge/:agentId/purge-complete
 *
 * Agent calls this after deleting all published files from the render share.
 * Clears publishedPackages and pending action on the agent record.
 * Body: { purgedPaths: string[] }
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

  let body: { purgedPaths?: string[] };
  try {
    body = await req.json() as typeof body;
  } catch {
    body = {};
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const agent = await db
    .select({ displayName: renderBridgeAgents.displayName })
    .from(renderBridgeAgents)
    .where(eq(renderBridgeAgents.id, agentId))
    .get();

  await db
    .update(renderBridgeAgents)
    .set({
      publishedPackagesJson: "[]",
      pendingAction: null,
      lastHeartbeatAt: now,
    })
    .where(eq(renderBridgeAgents.id, agentId));

  void (async () => {
    await db.insert(bridgeEvents).values({
      id: crypto.randomUUID(),
      grantId: null,
      packageId: "_lifecycle_",
      deviceId: agentId,
      userId: null,
      eventType: "agent_purge_complete",
      severity: "warn",
      detail: JSON.stringify({ purgedPathCount: body.purgedPaths?.length ?? 0 }),
      createdAt: now,
    });

    if (agent) {
      await sendEmail({
        to: [...ADMIN_EMAILS],
        subject: `Render bridge self-purged: ${agent.displayName}`,
        html: `<p>Render bridge agent <strong>${agent.displayName}</strong> completed a self-purge (${body.purgedPaths?.length ?? 0} paths cleared from render share).</p><p style="color:#6b7280;font-size:12px">Agent ID: ${agentId}</p>`,
      });
    }
  })();

  return NextResponse.json({ ok: true });
}
