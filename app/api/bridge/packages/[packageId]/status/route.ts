export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { bridgeGrants, licences, users } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import {
  requireBridgeToken,
  isBridgeTokenError,
} from "@/lib/auth/requireBridgeToken";

type GrantStatus = "active" | "revoked" | "expired" | "vault_locked";

const TIGHT_POLL_INTERVAL_SECS = 30;
const DEFAULT_POLL_INTERVAL_SECS = 300;

function resolveStatus(
  revokedAt: number | null,
  offlineUntil: number,
  vaultLocked: boolean,
  now: number
): GrantStatus {
  if (vaultLocked) return "vault_locked";
  if (revokedAt) return "revoked";
  if (offlineUntil < now) return "expired";
  return "active";
}

function purgeRequired(
  purgeRequestedAt: number | null,
  purgeCompletedAt: number | null,
): boolean {
  return purgeRequestedAt !== null && purgeCompletedAt === null;
}

/**
 * GET /api/bridge/packages/:packageId/status
 *
 * PAT-authenticated. Used by the Bridge app to poll whether its grant is
 * still valid.
 *
 * Query params:
 *   ?grantId=<uuid>  — check a specific grant (returns single object)
 *   (none)           — return all non-revoked grants for caller on this package
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const auth = await requireBridgeToken(req);
  if (isBridgeTokenError(auth)) return auth;

  const { packageId } = await params;
  const { searchParams } = new URL(req.url);
  const grantId = searchParams.get("grantId");

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  if (grantId) {
    // ── Single-grant status check ──────────────────────────────────────────
    const grant = await db
      .select({
        id: bridgeGrants.id,
        licenceId: bridgeGrants.licenceId,
        userId: bridgeGrants.userId,
        tool: bridgeGrants.tool,
        deviceId: bridgeGrants.deviceId,
        expiresAt: bridgeGrants.expiresAt,
        offlineUntil: bridgeGrants.offlineUntil,
        revokedAt: bridgeGrants.revokedAt,
        createdAt: bridgeGrants.createdAt,
        purgeRequestedAt: bridgeGrants.purgeRequestedAt,
        purgeCompletedAt: bridgeGrants.purgeCompletedAt,
      })
      .from(bridgeGrants)
      .where(
        and(eq(bridgeGrants.id, grantId), eq(bridgeGrants.packageId, packageId))
      )
      .get();

    if (!grant || grant.userId !== auth.userId) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }

    // Check vault lock
    let vaultLocked = false;
    const licence = await db
      .select({ talentId: licences.talentId })
      .from(licences)
      .where(eq(licences.id, grant.licenceId))
      .get();

    if (licence) {
      const talent = await db
        .select({ vaultLocked: users.vaultLocked })
        .from(users)
        .where(eq(users.id, licence.talentId))
        .get();
      vaultLocked = talent?.vaultLocked ?? false;
    }

    const status = resolveStatus(grant.revokedAt, grant.offlineUntil, vaultLocked, now);
    const purgeNeeded = purgeRequired(grant.purgeRequestedAt, grant.purgeCompletedAt);

    return NextResponse.json({
      grantId: grant.id,
      status,
      tool: grant.tool,
      deviceId: grant.deviceId,
      expiresAt: grant.expiresAt,
      offlineUntil: grant.offlineUntil,
      revokedAt: grant.revokedAt ?? null,
      createdAt: grant.createdAt,
      purgeRequired: purgeNeeded,
      purgeRequestedAt: grant.purgeRequestedAt ?? null,
      purgeCompletedAt: grant.purgeCompletedAt ?? null,
      pollIntervalSeconds: purgeNeeded ? TIGHT_POLL_INTERVAL_SECS : DEFAULT_POLL_INTERVAL_SECS,
    });
  }

  // ── All active grants for this caller on this package ────────────────────
  const grants = await db
    .select({
      id: bridgeGrants.id,
      licenceId: bridgeGrants.licenceId,
      tool: bridgeGrants.tool,
      deviceId: bridgeGrants.deviceId,
      expiresAt: bridgeGrants.expiresAt,
      offlineUntil: bridgeGrants.offlineUntil,
      revokedAt: bridgeGrants.revokedAt,
      createdAt: bridgeGrants.createdAt,
      purgeRequestedAt: bridgeGrants.purgeRequestedAt,
      purgeCompletedAt: bridgeGrants.purgeCompletedAt,
    })
    .from(bridgeGrants)
    .where(
      and(
        eq(bridgeGrants.packageId, packageId),
        eq(bridgeGrants.userId, auth.userId),
        isNull(bridgeGrants.revokedAt)
      )
    )
    .all();

  const anyPurgeRequired = grants.some((g) =>
    purgeRequired(g.purgeRequestedAt, g.purgeCompletedAt),
  );

  return NextResponse.json({
    grants: grants.map((g) => {
      const purgeNeeded = purgeRequired(g.purgeRequestedAt, g.purgeCompletedAt);
      return {
        grantId: g.id,
        status: resolveStatus(null, g.offlineUntil, false, now),
        tool: g.tool,
        deviceId: g.deviceId,
        expiresAt: g.expiresAt,
        offlineUntil: g.offlineUntil,
        createdAt: g.createdAt,
        purgeRequired: purgeNeeded,
        purgeRequestedAt: g.purgeRequestedAt ?? null,
        purgeCompletedAt: g.purgeCompletedAt ?? null,
      };
    }),
    pollIntervalSeconds: anyPurgeRequired ? TIGHT_POLL_INTERVAL_SECS : DEFAULT_POLL_INTERVAL_SECS,
  });
}
