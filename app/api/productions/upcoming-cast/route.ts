import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCast, organisationMembers, talentProfiles, invites } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isIndustryRole } from "@/lib/auth/roles";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";

// GET /api/productions/upcoming-cast
// Cast the caller has reserved or invited across their productions that don't
// have a licence yet — the pre-licence backlog surfaced on My Licences so these
// don't feel "lost" before a licence materialises.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  // Only production-side users reserve/invite cast; talent never have this state.
  if (!isIndustryRole(session.role)) return NextResponse.json({ roles: [] });

  const db = getDb();

  const memberRows = await db
    .select({ organisationId: organisationMembers.organisationId })
    .from(organisationMembers)
    .where(eq(organisationMembers.userId, session.sub))
    .all();
  const orgIds = memberRows.map((r) => r.organisationId);
  if (orgIds.length === 0) return NextResponse.json({ roles: [] });

  const prodRows = await db
    .select({ id: productions.id, name: productions.name })
    .from(productions)
    .where(inArray(productions.organisationId, orgIds))
    .all();
  if (prodRows.length === 0) return NextResponse.json({ roles: [] });
  const prodIds = prodRows.map((p) => p.id);
  const prodNameMap = new Map(prodRows.map((p) => [p.id, p.name]));

  // No licence yet = won't appear in My Licences. Declined roles are dropped.
  const rows = await db
    .select({
      castId: productionCast.id,
      productionId: productionCast.productionId,
      status: productionCast.status,
      actorName: productionCast.actorName,
      characterName: productionCast.characterName,
      fullName: talentProfiles.fullName,
      inviteEmail: invites.email,
      addedAt: productionCast.addedAt,
    })
    .from(productionCast)
    .leftJoin(talentProfiles, eq(talentProfiles.userId, productionCast.talentId))
    .leftJoin(invites, eq(invites.id, productionCast.inviteId))
    .where(and(
      inArray(productionCast.productionId, prodIds),
      isNull(productionCast.licenceId),
      ne(productionCast.status, "declined"),
    ))
    .all();

  const roles = rows
    .sort((a, b) => b.addedAt - a.addedAt)
    .map((r) => ({
      castId: r.castId,
      productionId: r.productionId,
      productionName: prodNameMap.get(r.productionId) ?? "",
      name: r.fullName ?? r.inviteEmail ?? r.actorName ?? "—",
      characterName: r.characterName,
      status: r.status,
    }));

  return NextResponse.json({ roles });
}
