export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { renderBridgeAgents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  await db
    .update(renderBridgeAgents)
    .set({
      publishedPackagesJson: "[]",
      pendingAction: null,
      lastHeartbeatAt: now,
    })
    .where(eq(renderBridgeAgents.id, agentId));

  return NextResponse.json({ ok: true });
}
