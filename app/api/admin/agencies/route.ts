import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, invites, users } from "@/lib/db/schema";
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
 * POST /api/admin/agencies — provision a new talent agency and invite its first
 * administrator. The admin creates the org (AGY code); the first admin completes
 * the agent onboarding arc and becomes the agency owner on signup.
 *
 * Body: { name, adminEmail, website? }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { name?: string; adminEmail?: string; website?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const adminEmail = body.adminEmail?.trim().toLowerCase();

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    return NextResponse.json({ error: "A valid adminEmail is required" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Guard: the first admin must be a fresh signup (agents are invite-gated).
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail))
    .get();
  if (existingUser) {
    return NextResponse.json(
      { error: "An account with that email already exists. Attach them as an existing rep instead." },
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

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
  const { subject, html } = agentInviteEmail({
    to: adminEmail,
    agencyName: name,
    inviterEmail: session.email,
    isFirstAdmin: true,
    onboardingUrl: `${baseUrl}/agent-onboarding?token=${inviteId}`,
    expiresAt,
  });
  void sendEmail({ to: adminEmail, subject, html });

  // Re-read the minted short code for the response.
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
