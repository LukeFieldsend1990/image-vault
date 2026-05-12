export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { renderBridgeAgents, organisations, productions, licences, scanPackages, talentProfiles, organisationMembers } from "@/lib/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { requireBridgeToken, isBridgeTokenError } from "@/lib/auth/requireBridgeToken";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";

const ONLINE_THRESHOLD_SECS = 60;

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
 * POST /api/bridge/render-bridge
 *
 * Enrolment. Called once on Docker first-start. Auth via an existing bridge PAT
 * (issued to the org admin via /api/bridge/tokens).
 *
 * Body: { vendorId?, organisationId, projectId, displayName }
 * Returns 201: { agentId, serviceToken, tokenExpiresAt }
 */
export async function POST(req: NextRequest) {
  const auth = await requireBridgeToken(req);
  if (isBridgeTokenError(auth)) return auth;

  let body: { vendorId?: string; organisationId?: string; projectId?: string; displayName?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { organisationId, projectId, displayName } = body;
  if (!organisationId || !projectId || !displayName) {
    return NextResponse.json(
      { error: "organisationId, projectId, and displayName are required" },
      { status: 400 }
    );
  }

  const db = getDb();

  const [org, production] = await Promise.all([
    db.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, organisationId)).get(),
    db.select({ id: productions.id }).from(productions).where(eq(productions.id, projectId)).get(),
  ]);

  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  const agentId = crypto.randomUUID();
  const serviceToken = generateServiceToken();
  const serviceTokenHash = await sha256Hex(serviceToken);
  const now = Math.floor(Date.now() / 1000);
  const tokenExpiresAt = now + 365 * 86400;

  await db.insert(renderBridgeAgents).values({
    id: agentId,
    organisationId,
    productionId: projectId,
    displayName,
    serviceTokenHash,
    tokenExpiresAt,
    status: "active",
    publishedPackagesJson: "[]",
    createdAt: now,
  });

  return NextResponse.json(
    {
      agentId,
      serviceToken,
      tokenExpiresAt: new Date(tokenExpiresAt * 1000).toISOString(),
    },
    { status: 201 }
  );
}

/**
 * GET /api/bridge/render-bridge
 *
 * Session-authenticated. Returns render-bridge agents visible to the caller:
 *   licensee → agents for all orgs they're a member of
 *   talent/rep → agents serving their project-scoped licences
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  async function buildAgentPayload(rawAgents: Array<{
    id: string; displayName: string; organisationId: string; organisationName: string | null;
    productionId: string; productionName: string | null; status: string;
    lastHeartbeatAt: number | null; tokenExpiresAt: number | null;
    publishedPackagesJson: string; pendingAction: string | null; revokedAt: number | null;
  }>) {
    return Promise.all(rawAgents.map(async (agent) => {
      const agentLicences = await db
        .select({
          id: licences.id, packageId: licences.packageId, packageName: scanPackages.name,
          talentName: talentProfiles.fullName, validTo: licences.validTo, status: licences.status,
        })
        .from(licences)
        .leftJoin(scanPackages, eq(scanPackages.id, licences.packageId))
        .leftJoin(talentProfiles, eq(talentProfiles.userId, licences.talentId))
        .where(and(eq(licences.organisationId, agent.organisationId), eq(licences.productionId, agent.productionId)))
        .all();

      let publishedIds: string[] = [];
      try { publishedIds = JSON.parse(agent.publishedPackagesJson); } catch { /* empty */ }

      const publishedPackages = agentLicences
        .filter(l => l.packageId && publishedIds.includes(l.packageId))
        .map(l => ({ packageId: l.packageId!, packageName: l.packageName ?? l.packageId! }));

      return {
        agentId: agent.id,
        displayName: agent.displayName,
        organisationId: agent.organisationId,
        organisationName: agent.organisationName ?? agent.organisationId,
        productionId: agent.productionId,
        productionName: agent.productionName ?? agent.productionId,
        status: agent.status,
        lastHeartbeatAt: agent.lastHeartbeatAt,
        agentOnline: agent.lastHeartbeatAt !== null && agent.lastHeartbeatAt > now - ONLINE_THRESHOLD_SECS,
        tokenExpiresAt: agent.tokenExpiresAt,
        pendingAction: agent.pendingAction,
        revokedAt: agent.revokedAt,
        publishedPackages,
        licences: agentLicences.map(l => ({
          licenceId: l.id, packageId: l.packageId, packageName: l.packageName,
          talentName: l.talentName ?? null, validTo: l.validTo, status: l.status,
        })),
      };
    }));
  }

  const agentSelect = {
    id: renderBridgeAgents.id, displayName: renderBridgeAgents.displayName,
    organisationId: renderBridgeAgents.organisationId, organisationName: organisations.name,
    productionId: renderBridgeAgents.productionId, productionName: productions.name,
    status: renderBridgeAgents.status, lastHeartbeatAt: renderBridgeAgents.lastHeartbeatAt,
    tokenExpiresAt: renderBridgeAgents.tokenExpiresAt, publishedPackagesJson: renderBridgeAgents.publishedPackagesJson,
    pendingAction: renderBridgeAgents.pendingAction, revokedAt: renderBridgeAgents.revokedAt,
  };

  if (session.role === "licensee") {
    const memberships = await db
      .select({ organisationId: organisationMembers.organisationId })
      .from(organisationMembers)
      .where(eq(organisationMembers.userId, session.sub))
      .all();

    if (memberships.length === 0) return NextResponse.json({ agents: [] });

    const orgIds = memberships.map(m => m.organisationId);
    const rawAgents = await db
      .select(agentSelect)
      .from(renderBridgeAgents)
      .leftJoin(organisations, eq(organisations.id, renderBridgeAgents.organisationId))
      .leftJoin(productions, eq(productions.id, renderBridgeAgents.productionId))
      .where(inArray(renderBridgeAgents.organisationId, orgIds))
      .all();

    return NextResponse.json({ agents: await buildAgentPayload(rawAgents) });
  }

  if (session.role === "talent" || session.role === "rep") {
    const projectLicences = await db
      .select({ organisationId: licences.organisationId, productionId: licences.productionId })
      .from(licences)
      .where(and(eq(licences.talentId, session.sub), isNotNull(licences.organisationId), isNotNull(licences.productionId)))
      .all();

    if (projectLicences.length === 0) return NextResponse.json({ agents: [] });

    const seen = new Set<string>();
    const combos = projectLicences.filter(l => {
      const k = `${l.organisationId}:${l.productionId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const rawAgents = (await Promise.all(combos.map(combo =>
      db.select(agentSelect)
        .from(renderBridgeAgents)
        .leftJoin(organisations, eq(organisations.id, renderBridgeAgents.organisationId))
        .leftJoin(productions, eq(productions.id, renderBridgeAgents.productionId))
        .where(and(eq(renderBridgeAgents.organisationId, combo.organisationId!), eq(renderBridgeAgents.productionId, combo.productionId!)))
        .all()
    ))).flat();

    return NextResponse.json({ agents: await buildAgentPayload(rawAgents) });
  }

  return NextResponse.json({ agents: [] });
}
