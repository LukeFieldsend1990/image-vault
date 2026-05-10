export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, organisationInvites } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";

// POST /api/organisations/[id]/invites — send an invite email (owner/admin only)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const [membership] = await db
    .select({ memberRole: organisationMembers.memberRole })
    .from(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, session.sub)))
    .limit(1)
    .all();

  const isOrgAdmin = membership?.memberRole === "owner" || membership?.memberRole === "admin";
  if (!isOrgAdmin && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.email?.trim()) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const [org] = await db
    .select({ name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, id))
    .limit(1)
    .all();

  if (!org) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = Math.floor(Date.now() / 1000);
  const inviteId = crypto.randomUUID();
  const expiresAt = now + 7 * 24 * 60 * 60; // 7 days

  await db.insert(organisationInvites).values({
    id: inviteId,
    organisationId: id,
    invitedEmail: body.email.trim().toLowerCase(),
    invitedBy: session.sub,
    expiresAt,
    acceptedAt: null,
    createdAt: now,
  });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
  const joinUrl = `${baseUrl}/organisations/join?token=${inviteId}`;

  void sendEmail({
    to: body.email.trim(),
    subject: `You've been invited to join ${org.name} on Image Vault`,
    html: `
      <p>You've been invited to join <strong>${org.name}</strong> as a member on Image Vault.</p>
      <p><a href="${joinUrl}">Accept invitation</a></p>
      <p>This link expires in 7 days.</p>
      <p style="color:#888;font-size:12px;">If you don't have an account yet, you'll be able to sign up after clicking the link.</p>
    `,
  });

  return NextResponse.json({ inviteId }, { status: 201 });
}
