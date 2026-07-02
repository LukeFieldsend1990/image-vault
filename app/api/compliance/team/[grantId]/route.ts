import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { complianceGrants, invites } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getUnionIdsForUser, revokeGrant } from "@/lib/compliance/grants";
import { and, eq, isNull } from "drizzle-orm";

// DELETE /api/compliance/team/[grantId] — revoke a union watcher's grant or
// cancel a pending invite. The caller must be an admin or hold a platform-/union-
// scoped union grant for the same union as the target.

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ grantId: string }> },
) {
  const { grantId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  // Try as a compliance grant first.
  const grant = await db
    .select({
      id: complianceGrants.id,
      unionId: complianceGrants.unionId,
      complianceUserId: complianceGrants.complianceUserId,
      revokedAt: complianceGrants.revokedAt,
    })
    .from(complianceGrants)
    .where(eq(complianceGrants.id, grantId))
    .get();

  if (grant) {
    if (grant.revokedAt) return NextResponse.json({ error: "Already revoked" }, { status: 410 });
    if (grant.complianceUserId === session.sub) {
      return NextResponse.json({ error: "Cannot revoke your own access" }, { status: 400 });
    }
    if (!isAdmin(session.email)) {
      const myUnions = await getUnionIdsForUser(db, session.sub, { scopes: ["platform", "union"] });
      if (!grant.unionId || !myUnions.includes(grant.unionId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    await revokeGrant(db, grantId);
    return NextResponse.json({ ok: true });
  }

  // Try as a pending invite.
  const invite = await db
    .select({ id: invites.id, unionId: invites.unionId })
    .from(invites)
    .where(and(eq(invites.id, grantId), eq(invites.role, "compliance"), isNull(invites.usedAt)))
    .get();

  if (invite) {
    if (!isAdmin(session.email)) {
      const myUnions = await getUnionIdsForUser(db, session.sub, { scopes: ["platform", "union"] });
      if (!invite.unionId || !myUnions.includes(invite.unionId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    await db.update(invites).set({ usedAt: Math.floor(Date.now() / 1000) }).where(eq(invites.id, grantId));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
