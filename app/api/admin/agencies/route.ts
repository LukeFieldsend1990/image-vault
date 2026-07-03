import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, invites, users, talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { mintOrgCode } from "@/lib/codes/codes";
import { sendEmail } from "@/lib/email/send";
import { agentInviteEmail } from "@/lib/email/templates";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

/**
 * GET /api/admin/agencies — list provisioned talent agencies with agent counts.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

  const rows = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      website: organisations.website,
      shortCode: organisations.shortCode,
      createdAt: organisations.createdAt,
    })
    .from(organisations)
    .where(eq(organisations.orgType, "agency"))
    .orderBy(organisations.createdAt)
    .all();

  const result = await Promise.all(
    rows.map(async (org) => {
      const [members] = await db
        .select({ n: sql<number>`count(*)` })
        .from(organisationMembers)
        .where(eq(organisationMembers.organisationId, org.id))
        .all();
      return { ...org, memberCount: members?.n ?? 0 };
    }),
  );

  return NextResponse.json({ agencies: result });
}

/**
 * POST /api/admin/agencies — provision a new talent agency.
 *
 * Two modes:
 *   1. Invite path (default): Body { name, adminEmail, website? }
 *      Creates org + sends onboarding invite to a new (not yet signed up) user.
 *   2. Existing rep path: Body { name, existingRepEmail, website? }
 *      Creates org + immediately links the existing rep user as owner.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { name?: string; adminEmail?: string; existingRepEmail?: string; website?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // ── Existing rep path ──────────────────────────────────────────────────────
  if (body.existingRepEmail) {
    const existingRepEmail = body.existingRepEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(existingRepEmail)) {
      return NextResponse.json({ error: "A valid existingRepEmail is required" }, { status: 400 });
    }

    const repUser = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, existingRepEmail))
      .get();
    if (!repUser) {
      return NextResponse.json({ error: "No user found with that email address." }, { status: 404 });
    }
    if (repUser.role !== "rep") {
      return NextResponse.json({ error: "That user is not a rep." }, { status: 409 });
    }

    const orgId = crypto.randomUUID();
    await db.insert(organisations).values({
      id: orgId,
      name,
      website: body.website?.trim() ?? null,
      orgType: "agency",
      createdBy: session.sub,
      createdAt: now,
      updatedAt: now,
    });
    await mintOrgCode(db, orgId, "agency");

    await db.insert(organisationMembers).values({
      organisationId: orgId,
      userId: repUser.id,
      memberRole: "owner",
      invitedBy: session.sub,
      joinedAt: now,
    });

    // Backfill routing on unaffiliated representation rows.
    await db
      .update(talentReps)
      .set({ agencyOrgId: orgId })
      .where(and(eq(talentReps.repId, repUser.id), isNull(talentReps.agencyOrgId)));

    const created = await db
      .select({ shortCode: organisations.shortCode })
      .from(organisations)
      .where(eq(organisations.id, orgId))
      .get();

    return NextResponse.json(
      { organisationId: orgId, shortCode: created?.shortCode ?? null, ownerLinked: true },
      { status: 201 },
    );
  }

  // ── Invite path ────────────────────────────────────────────────────────────
  const adminEmail = body.adminEmail?.trim().toLowerCase();
  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    return NextResponse.json({ error: "A valid adminEmail is required" }, { status: 400 });
  }

  // Guard: the first admin must be a fresh signup (agents are invite-gated).
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail))
    .get();
  if (existingUser) {
    return NextResponse.json(
      { error: "An account with that email already exists. Use the existing agent option instead." },
      { status: 409 },
    );
  }

  const existingInvite = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.email, adminEmail), isNull(invites.usedAt), gt(invites.expiresAt, now)))
    .get();
  if (existingInvite) {
    return NextResponse.json({ error: "A pending invite already exists for that email" }, { status: 409 });
  }

  const orgId = crypto.randomUUID();
  await db.insert(organisations).values({
    id: orgId,
    name,
    website: body.website?.trim() ?? null,
    orgType: "agency",
    createdBy: session.sub,
    createdAt: now,
    updatedAt: now,
  });
  await mintOrgCode(db, orgId, "agency");

  const inviteId = crypto.randomUUID();
  const expiresAt = now + SEVEN_DAYS;
  await db.insert(invites).values({
    id: inviteId,
    email: adminEmail,
    role: "rep",
    invitedBy: session.sub,
    usedAt: null,
    expiresAt,
    createdAt: now,
    organisationId: orgId,
  });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";
  const { subject, html } = agentInviteEmail({
    to: adminEmail,
    agencyName: name,
    inviterEmail: session.email,
    isFirstAdmin: true,
    onboardingUrl: `${baseUrl}/agent-onboarding?token=${inviteId}`,
    expiresAt,
  });
  void sendEmail({ to: adminEmail, subject, html });

  const created = await db
    .select({ shortCode: organisations.shortCode })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .get();

  return NextResponse.json(
    { organisationId: orgId, shortCode: created?.shortCode ?? null, inviteId },
    { status: 201 },
  );
}
