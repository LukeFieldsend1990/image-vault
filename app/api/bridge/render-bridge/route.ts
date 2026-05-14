export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { renderBridgeAgents, organisations, licences, scanPackages, scanFiles, bridgeEvents, talentProfiles, organisationMembers } from "@/lib/db/schema";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
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
 * Enrolment. Called once on Docker first-start. Auth via an existing bridge PAT.
 * Agents are org-scoped — they pull all licences granted to the org across all productions.
 *
 * Body: { organisationId, displayName }
 * Returns 201: { agentId, serviceToken, tokenExpiresAt }
 */
export async function POST(req: NextRequest) {
  const auth = await requireBridgeToken(req);
  if (isBridgeTokenError(auth)) return auth;

  let body: { organisationId?: string; displayName?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { organisationId, displayName } = body;
  if (!organisationId || !displayName) {
    return NextResponse.json(
      { error: "organisationId and displayName are required" },
      { status: 400 }
    );
  }

  const db = getDb();

  const org = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .get();

  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  // Revoke any existing active agents with the same display name so re-enrolment
  // after a Docker image update doesn't accumulate duplicates.
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(renderBridgeAgents)
    .set({ status: "revoked", revokedAt: now, pendingAction: "purge" })
    .where(
      and(
        eq(renderBridgeAgents.organisationId, organisationId),
        eq(renderBridgeAgents.displayName, displayName),
        isNull(renderBridgeAgents.revokedAt),
      )
    );

  const agentId = crypto.randomUUID();
  const serviceToken = generateServiceToken();
  const serviceTokenHash = await sha256Hex(serviceToken);
  const tokenExpiresAt = now + 365 * 86400;

  await db.insert(renderBridgeAgents).values({
    id: agentId,
    organisationId,
    productionId: null,
    displayName,
    serviceTokenHash,
    tokenExpiresAt,
    status: "active",
    publishedPackagesJson: "[]",
    createdAt: now,
  });

  return NextResponse.json(
    { agentId, serviceToken, tokenExpiresAt: new Date(tokenExpiresAt * 1000).toISOString() },
    { status: 201 }
  );
}

/**
 * GET /api/bridge/render-bridge
 *
 * Session-authenticated. Returns render-bridge agents visible to the caller:
 *   licensee → agents for all orgs they belong to
 *   talent/rep → agents for orgs that hold licences covering their work
 *   admin → all agents
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  async function buildAgentPayload(rawAgents: Array<{
    id: string; displayName: string; organisationId: string; organisationName: string | null;
    status: string; lastHeartbeatAt: number | null; tokenExpiresAt: number | null;
    publishedPackagesJson: string; pendingAction: string | null; revokedAt: number | null;
  }>) {
    return Promise.all(rawAgents.map(async (agent) => {
      const memberIds = await db
        .select({ userId: organisationMembers.userId })
        .from(organisationMembers)
        .where(eq(organisationMembers.organisationId, agent.organisationId))
        .all()
        .then(rows => rows.map(r => r.userId));

      const agentLicences = await db
        .select({
          id: licences.id,
          packageId: licences.packageId,
          packageName: scanPackages.name,
          talentName: talentProfiles.fullName,
          projectName: licences.projectName,
          validFrom: licences.validFrom,
          validTo: licences.validTo,
          status: licences.status,
          deliveryMode: licences.deliveryMode,
          productionId: licences.productionId,
        })
        .from(licences)
        .leftJoin(scanPackages, eq(scanPackages.id, licences.packageId))
        .leftJoin(talentProfiles, eq(talentProfiles.userId, licences.talentId))
        .where(
          and(
            isNotNull(licences.packageId),
            memberIds.length > 0
              ? or(
                  eq(licences.organisationId, agent.organisationId),
                  inArray(licences.licenseeId, memberIds)
                )
              : eq(licences.organisationId, agent.organisationId)
          )
        )
        .all();

      let publishedIds: string[] = [];
      try { publishedIds = JSON.parse(agent.publishedPackagesJson); } catch { /* empty */ }

      const licencePackageIds = new Set(agentLicences.filter(l => l.packageId).map(l => l.packageId!));
      const allPackageIds = [...new Set([...licencePackageIds, ...publishedIds])];

      // File counts for all relevant packages (for "downloading · N files" display)
      const fileCountRows = allPackageIds.length > 0
        ? await db
            .select({
              packageId: scanFiles.packageId,
              fileCount: sql<number>`count(*)`.as("file_count"),
            })
            .from(scanFiles)
            .where(inArray(scanFiles.packageId, allPackageIds))
            .groupBy(scanFiles.packageId)
            .all()
        : [];
      const packageFileCounts: Record<string, number> = {};
      for (const row of fileCountRows) {
        packageFileCounts[row.packageId] = Number(row.fileCount);
      }

      // Authorised published packages — in publishedIds AND covered by a licence
      const publishedPackages = [
        ...new Map(
          agentLicences
            .filter(l => l.packageId && publishedIds.includes(l.packageId))
            .map(l => [l.packageId!, { packageId: l.packageId!, packageName: l.packageName ?? l.packageId! }])
        ).values(),
      ];

      // Unauthorised published packages — in publishedIds but no licence covers them
      const unlicensedPublishedIds = publishedIds.filter(id => !licencePackageIds.has(id));
      let unauthorisedPublishedPackages: Array<{ packageId: string; packageName: string }> = [];
      if (unlicensedPublishedIds.length > 0) {
        const rows = await db
          .select({ id: scanPackages.id, name: scanPackages.name })
          .from(scanPackages)
          .where(inArray(scanPackages.id, unlicensedPublishedIds))
          .all();
        unauthorisedPublishedPackages = rows.map(r => ({ packageId: r.id, packageName: r.name }));

        // Trigger purge + log audit event (only if not already pending purge)
        if (agent.pendingAction !== "purge") {
          await db
            .update(renderBridgeAgents)
            .set({ pendingAction: "purge" })
            .where(eq(renderBridgeAgents.id, agent.id));

          await Promise.all(
            unlicensedPublishedIds.map(pkgId =>
              db.insert(bridgeEvents).values({
                id: crypto.randomUUID(),
                grantId: null,
                packageId: pkgId,
                deviceId: agent.id,
                userId: null,
                eventType: "unexpected_copy",
                severity: "critical",
                detail: JSON.stringify({ reason: "published_without_bridge_licence", agentId: agent.id }),
                createdAt: now,
              })
            )
          );
        }
      }

      return {
        agentId: agent.id,
        displayName: agent.displayName,
        organisationId: agent.organisationId,
        organisationName: agent.organisationName ?? agent.organisationId,
        status: agent.status,
        lastHeartbeatAt: agent.lastHeartbeatAt,
        agentOnline: agent.lastHeartbeatAt !== null && agent.lastHeartbeatAt > now - ONLINE_THRESHOLD_SECS,
        tokenExpiresAt: agent.tokenExpiresAt,
        pendingAction: agent.pendingAction,
        revokedAt: agent.revokedAt,
        publishedPackages,
        unauthorisedPublishedPackages,
        packageFileCounts,
        licences: agentLicences.map(l => ({
          licenceId: l.id,
          packageId: l.packageId,
          packageName: l.packageName,
          talentName: l.talentName ?? null,
          licenceName: l.projectName,
          validFrom: l.validFrom,
          validTo: l.validTo,
          status: l.status,
          deliveryMode: l.deliveryMode,
          productionId: l.productionId,
        })),
      };
    }));
  }

  const agentSelect = {
    id: renderBridgeAgents.id,
    displayName: renderBridgeAgents.displayName,
    organisationId: renderBridgeAgents.organisationId,
    organisationName: organisations.name,
    status: renderBridgeAgents.status,
    lastHeartbeatAt: renderBridgeAgents.lastHeartbeatAt,
    tokenExpiresAt: renderBridgeAgents.tokenExpiresAt,
    publishedPackagesJson: renderBridgeAgents.publishedPackagesJson,
    pendingAction: renderBridgeAgents.pendingAction,
    revokedAt: renderBridgeAgents.revokedAt,
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
      .where(and(inArray(renderBridgeAgents.organisationId, orgIds), isNull(renderBridgeAgents.revokedAt)))
      .all();

    return NextResponse.json({ agents: await buildAgentPayload(rawAgents) });
  }

  if (session.role === "talent" || session.role === "rep") {
    // Find orgs that hold licences covering this talent's work
    const talentLicenceOrgs = await db
      .select({ organisationId: licences.organisationId })
      .from(licences)
      .where(and(eq(licences.talentId, session.sub), isNotNull(licences.organisationId)))
      .all();

    if (talentLicenceOrgs.length === 0) return NextResponse.json({ agents: [] });

    const orgIds = [...new Set(talentLicenceOrgs.map(l => l.organisationId!))];
    const rawAgents = await db
      .select(agentSelect)
      .from(renderBridgeAgents)
      .leftJoin(organisations, eq(organisations.id, renderBridgeAgents.organisationId))
      .where(and(inArray(renderBridgeAgents.organisationId, orgIds), isNull(renderBridgeAgents.revokedAt)))
      .all();

    return NextResponse.json({ agents: await buildAgentPayload(rawAgents) });
  }

  if (session.role === "admin") {
    const rawAgents = await db
      .select(agentSelect)
      .from(renderBridgeAgents)
      .leftJoin(organisations, eq(organisations.id, renderBridgeAgents.organisationId))
      .where(isNull(renderBridgeAgents.revokedAt))
      .all();

    return NextResponse.json({ agents: await buildAgentPayload(rawAgents) });
  }

  return NextResponse.json({ agents: [] });
}
