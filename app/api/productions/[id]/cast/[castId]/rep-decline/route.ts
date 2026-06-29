import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCast, organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { createNotification } from "@/lib/notifications/create";
import { eq, and } from "drizzle-orm";

// POST /api/productions/[id]/cast/[castId]/rep-decline
// The assigned rep passes on a reserved slot — clears repId so the production
// can reassign it. Auth: the assigned rep, or admin.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; castId: string }> }
) {
  const { id, castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const production = await db
    .select({ id: productions.id, name: productions.name, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  const cast = await db
    .select({
      id: productionCast.id,
      repId: productionCast.repId,
      status: productionCast.status,
      addedBy: productionCast.addedBy,
      characterName: productionCast.characterName,
      actorName: productionCast.actorName,
    })
    .from(productionCast)
    .where(and(eq(productionCast.id, castId), eq(productionCast.productionId, id)))
    .get();
  if (!cast) return NextResponse.json({ error: "Cast member not found" }, { status: 404 });

  if (!isAdmin(session.email) && cast.repId !== session.sub) {
    return NextResponse.json({ error: "Forbidden — this role is not assigned to you" }, { status: 403 });
  }
  if (cast.status !== "placeholder") {
    return NextResponse.json({ error: `Cannot decline — role is already "${cast.status}"` }, { status: 409 });
  }

  // Unassign the rep — returns the slot to the production as an unassigned placeholder.
  await db.update(productionCast)
    .set({ repId: null, repInviteId: null })
    .where(eq(productionCast.id, castId));

  // Notify the production so they can reassign. Best-effort.
  void (async () => {
    try {
      const who = cast.characterName ?? cast.actorName ?? "a reserved role";
      const recipients = new Set<string>([cast.addedBy]);
      if (production.organisationId) {
        const members = await db
          .select({ userId: organisationMembers.userId, memberRole: organisationMembers.memberRole })
          .from(organisationMembers)
          .where(eq(organisationMembers.organisationId, production.organisationId))
          .all();
        members
          .filter((m) => m.memberRole === "owner" || m.memberRole === "admin")
          .forEach((m) => recipients.add(m.userId));
      }
      await Promise.all(
        Array.from(recipients).map((userId) =>
          createNotification(db, {
            userId,
            type: "cast_rep_filled",
            title: `An agent passed on ${who}`,
            body: `The agency assigned to ${who} in ${production.name} has declined the role. You can reassign it.`,
            href: `/productions/${id}`,
          }),
        ),
      );
    } catch {
      // best-effort
    }
  })();

  return NextResponse.json({ ok: true });
}
