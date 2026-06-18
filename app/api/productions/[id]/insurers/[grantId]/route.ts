export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, organisationMembers, invites, complianceGrants } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { revokeGrant } from "@/lib/compliance/grants";
import { eq, and, isNull } from "drizzle-orm";

// DELETE /api/productions/[id]/insurers/[grantId]
// Revoke an insurer's access to this production. The [grantId] segment is either
// an active compliance grant id or a pending invite id (both surface in GET).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; grantId: string }> },
) {
  const { id, grantId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  // Authorise: admin, or owner/admin of the production's organisation.
  const production = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, production.organisationId),
            eq(organisationMembers.userId, session.sub),
          ),
        )
        .get();
      if (!membership || (membership.memberRole !== "owner" && membership.memberRole !== "admin")) {
        return NextResponse.json({ error: "Forbidden — org owner or admin required" }, { status: 403 });
      }
    }
  }

  // Case 1: an active insurer grant scoped to this production.
  const grant = await db
    .select({ id: complianceGrants.id })
    .from(complianceGrants)
    .where(
      and(
        eq(complianceGrants.id, grantId),
        eq(complianceGrants.scope, "production"),
        eq(complianceGrants.scopeId, id),
        eq(complianceGrants.subtype, "insurer"),
        isNull(complianceGrants.revokedAt),
      ),
    )
    .get();
  if (grant) {
    await revokeGrant(db, grantId);
    return NextResponse.json({ status: "revoked" });
  }

  // Case 2: a pending (unused) compliance invite for this production.
  const invite = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        eq(invites.id, grantId),
        eq(invites.productionId, id),
        eq(invites.role, "compliance"),
        isNull(invites.usedAt),
      ),
    )
    .get();
  if (invite) {
    await db.delete(invites).where(eq(invites.id, grantId));
    return NextResponse.json({ status: "invite_revoked" });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
