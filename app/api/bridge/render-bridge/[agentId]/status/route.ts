export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { renderBridgeAgents, licences, organisationMembers } from "@/lib/db/schema";
import { and, eq, gt, inArray, isNotNull, or } from "drizzle-orm";
import {
  requireRenderBridgeToken,
  isRenderBridgeTokenError,
} from "@/lib/auth/requireRenderBridgeToken";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";

const ONLINE_THRESHOLD_SECS = 60;

/**
 * GET /api/bridge/render-bridge/:agentId/status
 *
 * Accepts either:
 *   - Bearer svc_... service token (render-bridge agent itself)
 *   - Session cookie (org member, talent with a licence at this org, or admin)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const authHeader = req.headers.get("authorization") ?? "";
  let callerUserId: string | null = null;
  let callerRole: string | null = null;

  if (authHeader.startsWith("Bearer ")) {
    const auth = await requireRenderBridgeToken(req);
    if (isRenderBridgeTokenError(auth)) return auth;
    if (auth.agentId !== agentId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
      status: renderBridgeAgents.status,
      lastHeartbeatAt: renderBridgeAgents.lastHeartbeatAt,
      publishedPackagesJson: renderBridgeAgents.publishedPackagesJson,
      buildRevision: renderBridgeAgents.buildRevision,
      revokedAt: renderBridgeAgents.revokedAt,
    })
    .from(renderBridgeAgents)
    .where(eq(renderBridgeAgents.id, agentId))
    .get();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Session callers: must be admin, org member, or talent with a licence at this org
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

  // Check for any active licence at this org (org-scoped or member-held)
  const memberRows = await db
    .select({ userId: organisationMembers.userId })
    .from(organisationMembers)
    .where(eq(organisationMembers.organisationId, agent.organisationId))
    .all();
  const memberIds = memberRows.map(r => r.userId);

  const activeLicence = await db
    .select({ id: licences.id })
    .from(licences)
    .where(
      and(
        eq(licences.status, "APPROVED"),
        gt(licences.validTo, now - 86400),
        isNotNull(licences.packageId),
        memberIds.length > 0
          ? or(
              eq(licences.organisationId, agent.organisationId),
              inArray(licences.licenseeId, memberIds)
            )
          : eq(licences.organisationId, agent.organisationId)
      )
    )
    .get();

  return NextResponse.json({
    agentId: agent.id,
    organisationId: agent.organisationId,
    hasActiveLicences: activeLicence !== undefined,
    status: agent.status,
    agentOnline,
    lastHeartbeatAt: agent.lastHeartbeatAt,
    publishedPackages,
    buildRevision: agent.buildRevision ?? null,
    revokedAt: agent.revokedAt,
  });
}
