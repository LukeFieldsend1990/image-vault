export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  bridgeGrants,
  bridgeEvents,
  scrubAttestations,
} from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  requireBridgeToken,
  isBridgeTokenError,
} from "@/lib/auth/requireBridgeToken";

/**
 * POST /api/bridge/grants/:grantId/purge-complete
 *
 * PAT-authenticated. Called by the Bridge desktop app after it has finished
 * deleting all locally cached files for a revoked/expired grant. Separates
 * "I purged everything" from the progress event stream so the platform has
 * a clean terminal signal to drive attestation UI + audit reports.
 *
 * Body: { filesDeleted: number, bytesFreed: number }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ grantId: string }> }
) {
  const auth = await requireBridgeToken(req);
  if (isBridgeTokenError(auth)) return auth;

  const { grantId } = await params;

  let body: { filesDeleted?: number; bytesFreed?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const filesDeleted = Number.isFinite(body.filesDeleted) ? Number(body.filesDeleted) : 0;
  const bytesFreed = Number.isFinite(body.bytesFreed) ? Number(body.bytesFreed) : 0;

  if (filesDeleted < 0 || bytesFreed < 0) {
    return NextResponse.json(
      { error: "filesDeleted and bytesFreed must be non-negative" },
      { status: 400 }
    );
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const grant = await db
    .select({
      id: bridgeGrants.id,
      licenceId: bridgeGrants.licenceId,
      packageId: bridgeGrants.packageId,
      deviceId: bridgeGrants.deviceId,
      userId: bridgeGrants.userId,
      purgeRequestedAt: bridgeGrants.purgeRequestedAt,
      purgeCompletedAt: bridgeGrants.purgeCompletedAt,
    })
    .from(bridgeGrants)
    .where(eq(bridgeGrants.id, grantId))
    .get();

  if (!grant || grant.userId !== auth.userId) {
    return NextResponse.json({ error: "Grant not found" }, { status: 404 });
  }

  // Idempotent — if already reported complete, short-circuit with the current state.
  if (grant.purgeCompletedAt !== null) {
    return NextResponse.json({ ok: true, alreadyComplete: true });
  }

  await db
    .update(bridgeGrants)
    .set({ purgeCompletedAt: now })
    .where(eq(bridgeGrants.id, grantId));

  await db.insert(bridgeEvents).values({
    id: crypto.randomUUID(),
    grantId: grant.id,
    packageId: grant.packageId,
    deviceId: grant.deviceId,
    userId: auth.userId,
    eventType: "cache_purged",
    severity: "info",
    detail: JSON.stringify({
      filesDeleted,
      bytesFreed,
      purgeRequestedAt: grant.purgeRequestedAt,
      source: "purge-complete",
    }),
    createdAt: now,
  });

  // If every active grant for this licence is now purged and an attestation
  // has already been submitted, flip bridge_cache_purged on the attestation
  // record so the closure report reflects platform-confirmed cleanup.
  const outstanding = await db
    .select({ id: bridgeGrants.id })
    .from(bridgeGrants)
    .where(
      and(
        eq(bridgeGrants.licenceId, grant.licenceId),
        isNull(bridgeGrants.revokedAt),
        isNull(bridgeGrants.purgeCompletedAt),
      ),
    )
    .all();

  if (outstanding.length === 0) {
    await db
      .update(scrubAttestations)
      .set({ bridgeCachePurged: true })
      .where(eq(scrubAttestations.licenceId, grant.licenceId));
  }

  return NextResponse.json({ ok: true });
}
