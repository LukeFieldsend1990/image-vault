import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { resolveOwnerAccess } from "@/lib/productions/access";
import { eq, and } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

// Only the production owner (org owner/admin) or a system admin may manage the team.
async function authorizeManager(
  db: Db,
  session: { sub: string; email: string; role: string },
  productionId: string,
) {
  const production = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, productionId))
    .get();
  if (!production) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  if (isAdmin(session.email)) return { production };
  if (!isIndustryRole(session.role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const access = await resolveOwnerAccess(db, productionId, production.organisationId, session.sub);
  if (!access.canManageTeam) {
    return { error: NextResponse.json({ error: "Forbidden — only the production owner can manage the team" }, { status: 403 }) };
  }
  return { production };
}

// PATCH /api/productions/[id]/team/[userId] — change a member's role.
// Body: { role: 'viewer' | 'editor' }.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeManager(db, session, id);
  if ("error" in auth) return auth.error;

  let body: { role?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.role !== "viewer" && body.role !== "editor") {
    return NextResponse.json({ error: "role must be 'viewer' or 'editor'" }, { status: 400 });
  }

  const existing = await db
    .select({ userId: productionMembers.userId })
    .from(productionMembers)
    .where(and(eq(productionMembers.productionId, id), eq(productionMembers.userId, userId)))
    .get();
  if (!existing) return NextResponse.json({ error: "Not on the team" }, { status: 404 });

  await db
    .update(productionMembers)
    .set({ role: body.role })
    .where(and(eq(productionMembers.productionId, id), eq(productionMembers.userId, userId)));
  return NextResponse.json({ ok: true });
}

// DELETE /api/productions/[id]/team/[userId] — remove a member from the team.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeManager(db, session, id);
  if ("error" in auth) return auth.error;

  await db
    .delete(productionMembers)
    .where(and(eq(productionMembers.productionId, id), eq(productionMembers.userId, userId)));
  return NextResponse.json({ ok: true });
}
