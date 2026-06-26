import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionVendors, organisationMembers, invites } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { unsyncVendorCountryOnProduction } from "@/lib/productions/vendors";
import { eq, and, isNull } from "drizzle-orm";

// DELETE /api/productions/[id]/vendors/[vendorId]
// Remove a vendor from a production: revoke an active attachment, or cancel a
// pending invite (also expiring the signup invite). Industry org owner/admin or admin.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; vendorId: string }> }
) {
  const { id, vendorId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const production = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(and(
          eq(organisationMembers.organisationId, production.organisationId),
          eq(organisationMembers.userId, session.sub),
        ))
        .get();
      if (!membership || (membership.memberRole !== "owner" && membership.memberRole !== "admin")) {
        return NextResponse.json({ error: "Forbidden — org owner or admin required" }, { status: 403 });
      }
    }
  }

  const row = await db
    .select({ id: productionVendors.id, status: productionVendors.status, inviteId: productionVendors.inviteId, vendorOrgId: productionVendors.vendorOrgId })
    .from(productionVendors)
    .where(and(eq(productionVendors.id, vendorId), eq(productionVendors.productionId, id)))
    .get();
  if (!row) return NextResponse.json({ error: "Vendor attachment not found" }, { status: 404 });

  const now = Math.floor(Date.now() / 1000);

  if (row.status === "pending") {
    // Cancel the pending invite + drop the row. Pending vendors have no
    // org yet, so there's nothing to unsync from production_countries.
    if (row.inviteId) {
      await db.update(invites).set({ expiresAt: now }).where(and(eq(invites.id, row.inviteId), isNull(invites.usedAt)));
    }
    await db.delete(productionVendors).where(eq(productionVendors.id, row.id));
    return NextResponse.json({ status: "invite_revoked" });
  }

  await db.update(productionVendors).set({ status: "revoked", revokedAt: now }).where(eq(productionVendors.id, row.id));

  // Drop the country this vendor caused to be added — but only if no other
  // active vendor on this production still needs it and it wasn't a manual
  // or home-country addition (see unsyncVendorCountryOnProduction).
  try {
    await unsyncVendorCountryOnProduction(db, {
      productionId: id,
      productionVendorId: row.id,
      vendorOrgId: row.vendorOrgId,
      actorUserId: session.sub,
    });
  } catch { /* best-effort; revocation already persisted */ }

  return NextResponse.json({ status: "revoked" });
}
