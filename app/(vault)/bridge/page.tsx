import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import BridgeClient from "./bridge-client";
import { isIndustryRole } from "@/lib/auth/roles";
import { getDb } from "@/lib/db";
import { bridgeTokens, renderBridgeAgents, bridgeAttestations, organisationMembers, organisations } from "@/lib/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import type { BridgeSetupStatus } from "@/lib/bridge/setup";

const AGENT_ONLINE_THRESHOLD_SECS = 60;

async function getSessionData() {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return null;
    const payload = JSON.parse(atob(session.split(".")[1])) as { sub?: string; role?: string };
    return { userId: payload.sub ?? "", role: payload.role ?? "talent" };
  } catch { return null; }
}

export default async function BridgePage() {
  const user = await getSessionData();
  if (!user) redirect("/login");
  if (!isIndustryRole(user.role) && user.role !== "talent" && user.role !== "rep" && user.role !== "admin") {
    redirect("/dashboard");
  }

  let setupStatus: BridgeSetupStatus | null = null;

  if (isIndustryRole(user.role) || user.role === "admin") {
    const db = getDb();
    // eslint-disable-next-line react-hooks/purity
    const now = Math.floor(Date.now() / 1000);

    const memberships = await db
      .select({ organisationId: organisationMembers.organisationId, orgName: organisations.name, orgShortCode: organisations.shortCode })
      .from(organisationMembers)
      .leftJoin(organisations, eq(organisations.id, organisationMembers.organisationId))
      .where(eq(organisationMembers.userId, user.userId))
      .all();

    if (memberships.length > 0) {
      const primary = memberships[0];
      const orgId = primary.organisationId;

      const [tokens, agents, attestations] = await Promise.all([
        db.select({ revokedAt: bridgeTokens.revokedAt }).from(bridgeTokens).where(eq(bridgeTokens.userId, user.userId)).all(),
        db.select({ lastHeartbeatAt: renderBridgeAgents.lastHeartbeatAt }).from(renderBridgeAgents).where(and(eq(renderBridgeAgents.organisationId, orgId), isNull(renderBridgeAgents.revokedAt))).all(),
        db.select({ kind: bridgeAttestations.kind, attestedAt: bridgeAttestations.attestedAt }).from(bridgeAttestations).where(eq(bridgeAttestations.organisationId, orgId)).all(),
      ]);

      const liveRows = attestations.filter(a => a.kind === "bridge_live");
      setupStatus = {
        orgId,
        orgName: primary.orgName ?? orgId,
        orgShortCode: primary.orgShortCode ?? null,
        hasToken: tokens.some(t => !t.revokedAt),
        agentEnrolled: agents.length > 0,
        agentOnline: agents.some(a => a.lastHeartbeatAt !== null && a.lastHeartbeatAt > now - AGENT_ONLINE_THRESHOLD_SECS),
        localAttested: attestations.some(a => a.kind === "local_access"),
        liveAttested: liveRows.length > 0,
        liveAttestedAt: liveRows.length > 0 ? Math.max(...liveRows.map(a => a.attestedAt)) : null,
      };
    }
  }

  return <BridgeClient role={user.role} setupStatus={setupStatus} />;
}
