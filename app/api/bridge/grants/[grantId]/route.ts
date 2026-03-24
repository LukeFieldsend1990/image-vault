export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { bridgeGrants, bridgeEvents, licences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";

/**
 * DELETE /api/bridge/grants/:grantId
 *
 * Session-authenticated. Revokes a Bridge grant.
 * Authorised callers: platform admin, the talent who owns the package,
 * or a rep with access to that talent.
 *
 * Records a `cache_purged` bridge event so the audit log is complete.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ grantId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { grantId } = await params;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const grant = await db
    .select({
      id: bridgeGrants.id,
      licenceId: bridgeGrants.licenceId,
      packageId: bridgeGrants.packageId,
      deviceId: bridgeGrants.deviceId,
      revokedAt: bridgeGrants.revokedAt,
    })
    .from(bridgeGrants)
    .where(eq(bridgeGrants.id, grantId))
    .get();

  if (!grant) {
    return NextResponse.json({ error: "Grant not found" }, { status: 404 });
  }
  if (grant.revokedAt !== null) {
    return NextResponse.json({ error: "Grant is already revoked" }, { status: 409 });
  }

  // ── Authorisation ─────────────────────────────────────────────────────────
  const isAdmin = session.role === "admin";
  let authorised = isAdmin;

  if (!authorised) {
    const licence = await db
      .select({ talentId: licences.talentId })
      .from(licences)
      .where(eq(licences.id, grant.licenceId))
      .get();

    if (licence) {
      if (session.sub === licence.talentId) {
        authorised = true;
      } else if (session.role === "rep") {
        authorised = await hasRepAccess(session.sub, licence.talentId);
      }
    }
  }

  if (!authorised) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Revoke ────────────────────────────────────────────────────────────────
  await db
    .update(bridgeGrants)
    .set({ revokedAt: now })
    .where(eq(bridgeGrants.id, grantId))
    .run();

  // Audit event
  await db.insert(bridgeEvents).values({
    id: crypto.randomUUID(),
    grantId: grant.id,
    packageId: grant.packageId,
    deviceId: grant.deviceId,
    userId: session.sub,
    eventType: "cache_purged",
    severity: "info",
    detail: JSON.stringify({ revokedBy: session.sub, role: session.role }),
    createdAt: now,
  });

  return NextResponse.json({ ok: true });
}
