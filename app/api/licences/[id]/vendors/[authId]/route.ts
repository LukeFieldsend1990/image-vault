export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, vendorAuthorisations } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isProductionSideOfLicence, isOrgMember } from "@/lib/licences/vendorAccess";
import { eq, and } from "drizzle-orm";

// DELETE /api/licences/[id]/vendors/[authId] — revoke a vendor authorisation (cascades to its sub-vendors)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; authId: string }> }
) {
  const { id, authId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const licence = await db
    .select({ id: licences.id, licenseeId: licences.licenseeId, organisationId: licences.organisationId })
    .from(licences)
    .where(eq(licences.id, id))
    .get();
  if (!licence) return NextResponse.json({ error: "Licence not found" }, { status: 404 });

  const auth = await db
    .select({ id: vendorAuthorisations.id, licenceId: vendorAuthorisations.licenceId, nominatedByOrgId: vendorAuthorisations.nominatedByOrgId, status: vendorAuthorisations.status })
    .from(vendorAuthorisations)
    .where(eq(vendorAuthorisations.id, authId))
    .get();
  if (!auth || auth.licenceId !== id) {
    return NextResponse.json({ error: "Authorisation not found" }, { status: 404 });
  }

  // The production side can revoke any vendor; a nominating vendor can revoke its own sub-vendors.
  const isProd = await isProductionSideOfLicence(db, session, licence);
  const isNominator = !!auth.nominatedByOrgId && (await isOrgMember(db, session.sub, auth.nominatedByOrgId));
  if (!isProd && !isNominator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (auth.status === "revoked") {
    return NextResponse.json({ ok: true, alreadyRevoked: true });
  }

  const now = Math.floor(Date.now() / 1000);

  // Revoke this auth and any sub-vendors nominated under it (one level — sub-vendors don't nest further here).
  await db
    .update(vendorAuthorisations)
    .set({ status: "revoked", revokedAt: now, revokedBy: session.sub })
    .where(eq(vendorAuthorisations.id, authId));
  await db
    .update(vendorAuthorisations)
    .set({ status: "revoked", revokedAt: now, revokedBy: session.sub })
    .where(and(eq(vendorAuthorisations.parentAuthorisationId, authId), eq(vendorAuthorisations.status, "active")));

  return NextResponse.json({ ok: true });
}
