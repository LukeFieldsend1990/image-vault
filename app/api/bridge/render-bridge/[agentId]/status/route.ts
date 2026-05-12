export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { renderBridgeAgents, licences, organisationMembers } from "@/lib/db/schema";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import {
  requireRenderBridgeToken,
  isRenderBridgeTokenError,
} from "@/lib/auth/requireRenderBridgeToken";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";

// Agent is considered online if last heartbeat is within 2 × 30s interval
const ONLINE_THRESHOLD_SECS = 60;

/**
 * GET /api/bridge/render-bridge/:agentId/status
 *
 * Accepts either:
 *   - Bearer svc_... service token (render-bridge agent itself)
 *   - Session cookie (org member or talent/rep on the related licence, or admin)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // ── Auth: service token or session ────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  let callerOrgId: string | null = null;
  let callerUserId: string | null = null;
  let callerRole: string | null = null;

  if (authHeader.startsWith("Bearer ")) {
    const auth = await requireRenderBridgeToken(req);
    if (isRenderBridgeTokenError(auth)) return auth;
    if (auth.agentId !== agentId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    callerOrgId = auth.organisationId;
  } else {
    const session = await requireSession(req);
    if (isErrorResponse(session)) return session;
    callerUserId = session.sub;
    callerRole = session.role;
  }

  const agent = await db
    .select({
      id: renderBridgeAgents.id,
      organisationId: renderBridgeAgents.organisationId,
      productionId: renderBridgeAgents.productionId,
      status: renderBridgeAgents.status,
      lastHeartbeatAt: renderBridgeAgents.lastHeartbeatAt,
      publishedPackagesJson: renderBridgeAgents.publishedPackagesJson,
      revokedAt: renderBridgeAgents.revokedAt,
    })
    .from(renderBridgeAgents)
    .where(eq(renderBridgeAgents.id, agentId))
    .get();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Session callers: must be admin, org member, or talent on a related licence
  if (callerUserId && callerRole !== "admin") {
    const [membership, talentLicence] = await Promise.all([
      db
        .select({ userId: organisationMembers.userId })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, agent.organisationId),
            eq(organisationMembers.userId, callerUserId)
          )
        )
        .get(),
      db
        .select({ id: licences.id })
        .from(licences)
        .where(
          and(
            eq(licences.organisationId, agent.organisationId),
            eq(licences.productionId, agent.productionId),
            eq(licences.talentId, callerUserId),
          )
        )
        .get(),
    ]);

    if (!membership && !talentLicence) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const agentOnline =
    agent.lastHeartbeatAt !== null &&
    agent.lastHeartbeatAt > now - ONLINE_THRESHOLD_SECS;

  let publishedPackages: string[] = [];
  try {
    publishedPackages = JSON.parse(agent.publishedPackagesJson);
  } catch {
    publishedPackages = [];
  }

  const activeLicence = await db
    .select({ id: licences.id })
    .from(licences)
    .where(
      and(
        eq(licences.organisationId, agent.organisationId),
        eq(licences.productionId, agent.productionId),
        eq(licences.status, "APPROVED"),
        gt(licences.validTo, now),
        isNotNull(licences.packageId),
      )
    )
    .get();

  return NextResponse.json({
    agentId: agent.id,
    projectGrantId: activeLicence ? `pg_${agent.productionId}` : null,
    status: agent.status,
    agentOnline,
    lastHeartbeatAt: agent.lastHeartbeatAt,
    publishedPackages,
    revokedAt: agent.revokedAt,
  });
}
