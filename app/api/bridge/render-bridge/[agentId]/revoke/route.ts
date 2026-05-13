export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { renderBridgeAgents, organisationMembers } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";

/**
 * POST /api/bridge/render-bridge/:agentId/revoke
 *
 * Revokes an agent. Callable by org members (licensee) or admin.
 * Sets pendingAction=purge so the agent purges its share on next heartbeat.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { agentId } = await params;
  const db = getDb();

  const agent = await db
    .select({
      id: renderBridgeAgents.id,
      organisationId: renderBridgeAgents.organisationId,
      revokedAt: renderBridgeAgents.revokedAt,
    })
    .from(renderBridgeAgents)
    .where(eq(renderBridgeAgents.id, agentId))
    .get();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (agent.revokedAt !== null) {
    return NextResponse.json({ error: "Agent already revoked" }, { status: 409 });
  }

  if (session.role !== "admin") {
    const membership = await db
      .select({ userId: organisationMembers.userId })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, agent.organisationId),
          eq(organisationMembers.userId, session.sub)
        )
      )
      .get();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const now = Math.floor(Date.now() / 1000);

  await db
    .update(renderBridgeAgents)
    .set({ status: "revoked", revokedAt: now, pendingAction: "purge" })
    .where(and(eq(renderBridgeAgents.id, agentId), isNull(renderBridgeAgents.revokedAt)));

  return NextResponse.json({ ok: true });
}
