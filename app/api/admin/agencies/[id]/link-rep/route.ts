import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, talentReps, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { and, eq, isNull } from "drizzle-orm";

/**
 * POST /api/admin/agencies/[id]/link-rep
 * Body: { repEmail }
 *
 * Attaches an existing `rep` user to an agency as a member (an "agent"), and
 * backfills `agency_org_id` on their representation rows so the performers they
 * already represent route to this agency's inbox. The corrective path for reps
 * that predate the agency model.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let body: { repEmail?: string } = {};
  try { body = await req.json(); } catch { /* ok */ }

  const repEmail = body.repEmail?.trim().toLowerCase();
  if (!repEmail) return NextResponse.json({ error: "repEmail is required" }, { status: 400 });

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const org = await db
    .select({ id: organisations.id, orgType: organisations.orgType })
    .from(organisations)
    .where(eq(organisations.id, id))
    .get();
  if (!org) return NextResponse.json({ error: "Agency not found" }, { status: 404 });
  if (org.orgType !== "agency") {
    return NextResponse.json({ error: "That organisation is not an agency" }, { status: 409 });
  }

  const repUser = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, repEmail))
    .get();
  if (!repUser) {
    return NextResponse.json({ error: "No user found with that email address." }, { status: 404 });
  }
  if (repUser.role !== "rep") {
    return NextResponse.json({ error: "That user is not a rep." }, { status: 409 });
  }

  // Add the agency membership (idempotent).
  const existingMember = await db
    .select({ userId: organisationMembers.userId })
    .from(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, repUser.id)))
    .get();
  if (!existingMember) {
    await db.insert(organisationMembers).values({
      organisationId: id,
      userId: repUser.id,
      memberRole: "member",
      invitedBy: session.sub,
      joinedAt: now,
    });
  }

  // Backfill routing on this rep's existing, unaffiliated representation rows.
  await db
    .update(talentReps)
    .set({ agencyOrgId: id })
    .where(and(eq(talentReps.repId, repUser.id), isNull(talentReps.agencyOrgId)));

  return NextResponse.json({ ok: true, repId: repUser.id, alreadyMember: !!existingMember });
}
