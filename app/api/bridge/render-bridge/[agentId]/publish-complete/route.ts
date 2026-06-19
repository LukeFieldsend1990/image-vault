import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { renderBridgeAgents, bridgeEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  requireRenderBridgeToken,
  isRenderBridgeTokenError,
} from "@/lib/auth/requireRenderBridgeToken";

/**
 * POST /api/bridge/render-bridge/:agentId/publish-complete
 *
 * Agent calls this after successfully writing a package's files to the share.
 * Body: { packageId: string, publishedPaths: string[] }
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

  let body: { packageId?: string; publishedPaths?: string[] };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.packageId) {
    return NextResponse.json({ error: "packageId is required" }, { status: 400 });
  }

  const db = getDb();

  const agent = await db
    .select({ publishedPackagesJson: renderBridgeAgents.publishedPackagesJson })
    .from(renderBridgeAgents)
    .where(eq(renderBridgeAgents.id, agentId))
    .get();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  let publishedPackages: string[] = [];
  try {
    publishedPackages = JSON.parse(agent.publishedPackagesJson);
  } catch {
    publishedPackages = [];
  }

  if (!publishedPackages.includes(body.packageId)) {
    publishedPackages.push(body.packageId);
  }

  const now = Math.floor(Date.now() / 1000);

  await db
    .update(renderBridgeAgents)
    .set({ publishedPackagesJson: JSON.stringify(publishedPackages) })
    .where(eq(renderBridgeAgents.id, agentId));

  void db.insert(bridgeEvents).values({
    id: crypto.randomUUID(),
    grantId: null,
    packageId: body.packageId,
    deviceId: agentId,
    userId: null,
    eventType: "agent_publish_complete",
    severity: "info",
    detail: JSON.stringify({
      packageId: body.packageId,
      publishedPathCount: body.publishedPaths?.length ?? 0,
    }),
    createdAt: now,
  });

  return NextResponse.json({ ok: true });
}
