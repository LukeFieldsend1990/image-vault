export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisationInvites, organisationMembers, organisations } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isIndustryRole } from "@/lib/auth/roles";
import { eq, and } from "drizzle-orm";

// POST /api/organisations/join — accept an invite token
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (!isIndustryRole(session.role) && session.role !== "admin") {
    return NextResponse.json({ error: "Only licensee accounts can join organisations" }, { status: 403 });
  }

  let body: { token?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.token?.trim()) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const [invite] = await db
    .select()
    .from(organisationInvites)
    .where(eq(organisationInvites.id, body.token.trim()))
    .limit(1)
    .all();

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
  }
  if (invite.acceptedAt !== null) {
    return NextResponse.json({ error: "This invite has already been used" }, { status: 409 });
  }
  if (invite.expiresAt < now) {
    return NextResponse.json({ error: "This invite has expired" }, { status: 410 });
  }

  // Check if already a member
  const [existing] = await db
    .select({ userId: organisationMembers.userId })
    .from(organisationMembers)
    .where(and(
      eq(organisationMembers.organisationId, invite.organisationId),
      eq(organisationMembers.userId, session.sub)
    ))
    .limit(1)
    .all();

  if (existing) {
    // Already a member — mark invite used and return success
    await db
      .update(organisationInvites)
      .set({ acceptedAt: now })
      .where(eq(organisationInvites.id, invite.id));
    return NextResponse.json({ organisationId: invite.organisationId });
  }

  await db.insert(organisationMembers).values({
    organisationId: invite.organisationId,
    userId: session.sub,
    memberRole: "member",
    invitedBy: invite.invitedBy,
    joinedAt: now,
  });

  await db
    .update(organisationInvites)
    .set({ acceptedAt: now })
    .where(eq(organisationInvites.id, invite.id));

  return NextResponse.json({ organisationId: invite.organisationId });
}

// GET /api/organisations/join?token=xxx — preview invite details (pre-auth, for the join page)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const [invite] = await db
    .select({
      id: organisationInvites.id,
      organisationId: organisationInvites.organisationId,
      invitedEmail: organisationInvites.invitedEmail,
      expiresAt: organisationInvites.expiresAt,
      acceptedAt: organisationInvites.acceptedAt,
    })
    .from(organisationInvites)
    .where(eq(organisationInvites.id, token))
    .limit(1)
    .all();

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
  }
  if (invite.acceptedAt !== null) {
    return NextResponse.json({ error: "This invite has already been used" }, { status: 409 });
  }
  if (invite.expiresAt < now) {
    return NextResponse.json({ error: "This invite has expired" }, { status: 410 });
  }

  const [org] = await db
    .select({ name: organisations.name, orgType: organisations.orgType, shortCode: organisations.shortCode })
    .from(organisations)
    .where(eq(organisations.id, invite.organisationId))
    .limit(1)
    .all();

  return NextResponse.json({
    organisationId: invite.organisationId,
    organisationName: org?.name ?? "Unknown Organisation",
    organisationType: org?.orgType ?? null,
    organisationShortCode: org?.shortCode ?? null,
    invitedEmail: invite.invitedEmail,
    expiresAt: invite.expiresAt,
  });
}
