export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productionCast, productions, organisationMembers, invites, licences } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, and } from "drizzle-orm";

async function checkOrgAccess(
  session: { sub: string; email: string; role: string },
  organisationId: string | null,
  db: ReturnType<typeof getDb>
): Promise<boolean> {
  if (isAdmin(session.email)) return true;
  if (session.role !== "licensee") return false;
  if (!organisationId) return true; // no org attached — allow licensee through
  const membership = await db
    .select({ memberRole: organisationMembers.memberRole })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        eq(organisationMembers.userId, session.sub)
      )
    )
    .get();
  return membership !== undefined && (membership.memberRole === "owner" || membership.memberRole === "admin");
}

// DELETE /api/productions/[id]/cast/[castId]
// Remove a cast member (only if status is invited or linked).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; castId: string }> }
) {
  const { id, castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const production = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  const allowed = await checkOrgAccess(session, production.organisationId, db);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const castRow = await db
    .select()
    .from(productionCast)
    .where(and(eq(productionCast.id, castId), eq(productionCast.productionId, id)))
    .get();

  if (!castRow) return NextResponse.json({ error: "Cast member not found" }, { status: 404 });

  if (castRow.status !== "placeholder" && castRow.status !== "invited" && castRow.status !== "linked") {
    return NextResponse.json(
      { error: "Cannot remove a cast member who has consented or completed the process" },
      { status: 409 }
    );
  }

  const now = Math.floor(Date.now() / 1000);

  // Soft-invalidate the invite (mark usedAt = now so it can't be accepted)
  if (castRow.inviteId) {
    await db
      .update(invites)
      .set({ usedAt: now })
      .where(eq(invites.id, castRow.inviteId));
  }

  // Revoke the associated licence so it doesn't linger in the talent's inbox
  if (castRow.licenceId) {
    await db
      .update(licences)
      .set({ status: "REVOKED", revokedAt: now })
      .where(eq(licences.id, castRow.licenceId));
  }

  // Delete the cast row
  await db.delete(productionCast).where(eq(productionCast.id, castId));

  return NextResponse.json({ ok: true });
}

// PATCH /api/productions/[id]/cast/[castId]
// Update character_name, department, sag_member fields.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; castId: string }> }
) {
  const { id, castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const production = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  const allowed = await checkOrgAccess(session, production.organisationId, db);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const castRow = await db
    .select({ id: productionCast.id })
    .from(productionCast)
    .where(and(eq(productionCast.id, castId), eq(productionCast.productionId, id)))
    .get();
  if (!castRow) return NextResponse.json({ error: "Cast member not found" }, { status: 404 });

  let body: { characterName?: string; department?: string; sagMember?: boolean; actorName?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Partial<typeof productionCast.$inferInsert> = {};
  if (typeof body.characterName === "string") updates.characterName = body.characterName;
  if (typeof body.department === "string") updates.department = body.department;
  if (typeof body.sagMember === "boolean") updates.sagMember = body.sagMember;
  if (typeof body.actorName === "string") updates.actorName = body.actorName;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  await db.update(productionCast).set(updates).where(eq(productionCast.id, castId));

  return NextResponse.json({ ok: true });
}
