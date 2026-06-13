export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, refreshTokens, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq } from "drizzle-orm";

async function requireAdminSession(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

// PATCH /api/admin/users/[id] — suspend or unsuspend a user
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireAdminSession(req);
  if (isErrorResponse(session)) return session;
  if (session instanceof NextResponse) return session;

  let body: { suspended?: boolean; emailMuted?: boolean; aiDisabled?: boolean; inboundEnabled?: boolean; geoFingerprintEnabled?: boolean; royaltyMeterEnabled?: boolean; complianceEnabled?: boolean; pitchVignettesEnabled?: boolean; role?: string } = {};
  try {
    body = JSON.parse(await req.text());
  } catch { /* ok */ }

  const hasSuspended = typeof body.suspended === "boolean";
  const hasEmailMuted = typeof body.emailMuted === "boolean";
  const hasAiDisabled = typeof body.aiDisabled === "boolean";
  const hasInboundEnabled = typeof body.inboundEnabled === "boolean";
  const hasGeoFingerprintEnabled = typeof body.geoFingerprintEnabled === "boolean";
  const hasRoyaltyMeterEnabled = typeof body.royaltyMeterEnabled === "boolean";
  const hasComplianceEnabled = typeof body.complianceEnabled === "boolean";
  const hasPitchVignettesEnabled = typeof body.pitchVignettesEnabled === "boolean";
  const validRoles = ["talent", "rep", "licensee"] as const;
  const hasRole = typeof body.role === "string" && validRoles.includes(body.role as typeof validRoles[number]);

  if (!hasSuspended && !hasEmailMuted && !hasAiDisabled && !hasInboundEnabled && !hasGeoFingerprintEnabled && !hasRoyaltyMeterEnabled && !hasComplianceEnabled && !hasPitchVignettesEnabled && !hasRole) {
    return NextResponse.json({ error: "suspended, emailMuted, aiDisabled, inboundEnabled, geoFingerprintEnabled, royaltyMeterEnabled, complianceEnabled, pitchVignettesEnabled, or role is required" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  if (hasSuspended) {
    await db
      .update(users)
      .set({ suspendedAt: body.suspended ? now : null })
      .where(eq(users.id, id));

    // Revoke all refresh tokens so the suspended user is immediately logged out
    if (body.suspended) {
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, id));
    }
  }

  if (hasEmailMuted) {
    await db
      .update(users)
      .set({ emailMuted: body.emailMuted! })
      .where(eq(users.id, id));
  }

  if (hasAiDisabled) {
    await db
      .update(users)
      .set({ aiDisabled: body.aiDisabled! })
      .where(eq(users.id, id));
  }

  if (hasInboundEnabled) {
    await db
      .update(users)
      .set({ inboundEnabled: body.inboundEnabled! })
      .where(eq(users.id, id));
  }

  if (hasGeoFingerprintEnabled) {
    await db
      .update(users)
      .set({ geoFingerprintEnabled: body.geoFingerprintEnabled! })
      .where(eq(users.id, id));
  }

  if (hasRoyaltyMeterEnabled) {
    await db
      .update(users)
      .set({ royaltyMeterEnabled: body.royaltyMeterEnabled! })
      .where(eq(users.id, id));
  }

  if (hasComplianceEnabled) {
    await db
      .update(users)
      .set({ complianceEnabled: body.complianceEnabled! })
      .where(eq(users.id, id));
  }

  if (hasPitchVignettesEnabled) {
    await db
      .update(talentProfiles)
      .set({ pitchVignettesEnabled: body.pitchVignettesEnabled! })
      .where(eq(talentProfiles.userId, id));
  }

  if (hasRole) {
    await db
      .update(users)
      .set({ role: body.role as "talent" | "rep" | "licensee" | "admin" })
      .where(eq(users.id, id));
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/users/[id] — permanently delete a user
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireAdminSession(req);
  if (isErrorResponse(session)) return session;
  if (session instanceof NextResponse) return session;

  const db = getDb();
  await db.delete(users).where(eq(users.id, id));

  return NextResponse.json({ deleted: true });
}
