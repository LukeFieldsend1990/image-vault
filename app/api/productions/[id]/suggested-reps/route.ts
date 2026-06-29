import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCast, users, organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { eq, and, isNotNull, inArray } from "drizzle-orm";

// GET /api/productions/[id]/suggested-reps
// Returns reps who have previously been assigned to cast slots in other
// productions by the same organisation — so the picker can show relevant
// suggestions without exposing the full rep directory.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const production = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(and(
          eq(organisationMembers.organisationId, production.organisationId),
          eq(organisationMembers.userId, session.sub),
        ))
        .get();
      if (!membership) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  if (!production.organisationId) {
    return NextResponse.json({ reps: [] });
  }

  // All other productions by the same org (excluding this one)
  const siblingProductions = await db
    .select({ id: productions.id })
    .from(productions)
    .where(and(
      eq(productions.organisationId, production.organisationId),
    ))
    .all();

  const siblingIds = siblingProductions.map((p) => p.id).filter((pid) => pid !== id);
  if (siblingIds.length === 0) return NextResponse.json({ reps: [] });

  // Cast slots in sibling productions that have a confirmed rep assigned
  const castRows = await db
    .select({ repId: productionCast.repId })
    .from(productionCast)
    .where(and(
      inArray(productionCast.productionId, siblingIds),
      isNotNull(productionCast.repId),
    ))
    .all();

  const repIds = [...new Set(castRows.map((r) => r.repId!))];
  if (repIds.length === 0) return NextResponse.json({ reps: [] });

  const reps = await db
    .select({ id: users.id, email: users.email, shortCode: users.shortCode })
    .from(users)
    .where(inArray(users.id, repIds))
    .all();

  return NextResponse.json({ reps });
}
