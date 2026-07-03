import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, invites, users, talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isAgencyAdmin } from "@/lib/agency/membership";
import { sendEmail } from "@/lib/email/send";
import { agentInviteEmail } from "@/lib/email/templates";
import { and, eq, gt, isNull } from "drizzle-orm";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

async function loadAgency(db: ReturnType<typeof getDb>, id: string) {
  return db
    .select({ id: organisations.id, name: organisations.name, orgType: organisations.orgType })
    .from(organisations)
    .where(eq(organisations.id, id))
    .get();
}

/**
 * GET /api/organisations/[id]/agents — list the agency's agents (members) and
 * any pending agent invites. Visible to agency admins and platform admins.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const platformAdmin = session.role === "admin" || isAdmin(session.email);
  if (!platformAdmin && !(await isAgencyAdmin(db, session.sub, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const agency = await loadAgency(db, id);
  if (!agency) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (agency.orgType !== "agency") {
    return NextResponse.json({ error: "Not an agency" }, { status: 409 });
  }

  const members = await db
    .select({
      userId: organisationMembers.userId,
      email: users.email,
      shortCode: users.shortCode,
      memberRole: organisationMembers.memberRole,
      joinedAt: organisationMembers.joinedAt,
    })
    .from(organisationMembers)
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(eq(organisationMembers.organisationId, id))
    .all();

  const now = Math.floor(Date.now() / 1000);
  const pending = await db
    .select({ id: invites.id, email: invites.email, createdAt: invites.createdAt, expiresAt: invites.expiresAt })
    .from(invites)
    .where(and(eq(invites.organisationId, id), isNull(invites.usedAt), gt(invites.expiresAt, now)))
    .all();

  return NextResponse.json({
    agency: { id: agency.id, name: agency.name },
    members,
    pendingInvites: pending,
  });
}

/**
 * POST /api/organisations/[id]/agents — invite a new agent to the agency.
 * Body: { email }. Sends the agent onboarding arc link. The invitee signs up as
 * a `rep` and joins this agency as a member on completion.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const platformAdmin = session.role === "admin" || isAdmin(session.email);
  if (!platformAdmin && !(await isAgencyAdmin(db, session.sub, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const agency = await loadAgency(db, id);
  if (!agency) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (agency.orgType !== "agency") {
    return NextResponse.json({ error: "Not an agency" }, { status: 409 });
  }

  let body: { email?: string } = {};
  try { body = await req.json(); } catch { /* ok */ }
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  const existingUser = await db
    .select({ id: users.id, role: users.role, shortCode: users.shortCode })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (existingUser) {
    if (existingUser.role !== "rep") {
      return NextResponse.json(
        { error: "That account is not a rep and cannot be added as an agent." },
        { status: 409 },
      );
    }

    // Check if the rep is already in a different agency.
    const otherAgency = await db
      .select({ organisationId: organisationMembers.organisationId })
      .from(organisationMembers)
      .innerJoin(organisations, eq(organisations.id, organisationMembers.organisationId))
      .where(
        and(
          eq(organisationMembers.userId, existingUser.id),
          eq(organisations.orgType, "agency"),
        ),
      )
      .get();
    if (otherAgency && otherAgency.organisationId !== id) {
      return NextResponse.json(
        { error: "That agent is already a member of another agency." },
        { status: 409 },
      );
    }
    if (otherAgency && otherAgency.organisationId === id) {
      return NextResponse.json(
        { error: "That agent is already a member of this agency." },
        { status: 409 },
      );
    }

    // Attach the existing rep to this agency.
    await db.insert(organisationMembers).values({
      organisationId: id,
      userId: existingUser.id,
      memberRole: "member",
      invitedBy: session.sub,
      joinedAt: now,
    });

    // Backfill routing on any unaffiliated representation rows.
    await db
      .update(talentReps)
      .set({ agencyOrgId: id })
      .where(and(eq(talentReps.repId, existingUser.id), isNull(talentReps.agencyOrgId)));

    return NextResponse.json({
      attached: true,
      userId: existingUser.id,
      email,
      shortCode: existingUser.shortCode,
      memberRole: "member",
      joinedAt: now,
    }, { status: 201 });
  }

  const existingInvite = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.email, email), isNull(invites.usedAt), gt(invites.expiresAt, now)))
    .get();
  if (existingInvite) {
    return NextResponse.json({ error: "A pending invite already exists for that email" }, { status: 409 });
  }

  const inviteId = crypto.randomUUID();
  const expiresAt = now + SEVEN_DAYS;
  await db.insert(invites).values({
    id: inviteId,
    email,
    role: "rep",
    invitedBy: session.sub,
    usedAt: null,
    expiresAt,
    createdAt: now,
    organisationId: id,
  });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";
  const { subject, html } = agentInviteEmail({
    to: email,
    agencyName: agency.name,
    inviterEmail: session.email,
    isFirstAdmin: false,
    onboardingUrl: `${baseUrl}/agent-onboarding?token=${inviteId}`,
    expiresAt,
  });
  void sendEmail({ to: email, subject, html });

  return NextResponse.json({ inviteId }, { status: 201 });
}
