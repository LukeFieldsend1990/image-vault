import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCast, organisations, organisationMembers, invites, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { mintConsentToken } from "@/lib/consent/token";
import { sendEmail } from "@/lib/email/send";
import { consentRequestEmail } from "@/lib/email/templates";
import { eq, and } from "drizzle-orm";

// POST /api/productions/[id]/cast/[castId]/consent-link
// Mint a tokenised public consent link for an unregistered production-held cast
// member and (by default) email it to them. Returns the URL. Industry org
// owner/admin or admin.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; castId: string }> }) {
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

  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(and(eq(organisationMembers.organisationId, production.organisationId), eq(organisationMembers.userId, session.sub)))
        .get();
      if (!membership || (membership.memberRole !== "owner" && membership.memberRole !== "admin")) {
        return NextResponse.json({ error: "Forbidden — org owner or admin required" }, { status: 403 });
      }
    }
  }

  const cast = await db
    .select({
      id: productionCast.id,
      talentId: productionCast.talentId,
      actorName: productionCast.actorName,
      inviteId: productionCast.inviteId,
      repId: productionCast.repId,
      repInviteId: productionCast.repInviteId,
    })
    .from(productionCast)
    .where(and(eq(productionCast.id, castId), eq(productionCast.productionId, id)))
    .get();
  if (!cast) return NextResponse.json({ error: "Cast member not found" }, { status: 404 });
  if (cast.talentId) return NextResponse.json({ error: "This performer is already registered — they review consent in their account." }, { status: 409 });

  // Resolve a contact email. Priority:
  //   1. explicit `email` in the request body (operator override)
  //   2. the performer's own invite email
  //   3. the assigned rep's email (registered user, then pending invite)
  // (3) covers the Clear Angle / agent-mediated flow — the producer has assigned
  // a rep to this placeholder but doesn't yet have the performer's email; the
  // rep reviews & confirms consent on their client's behalf.
  let email = "";
  let recipientIsRep = false;
  if (cast.inviteId) {
    const inv = await db.select({ email: invites.email }).from(invites).where(eq(invites.id, cast.inviteId)).get();
    email = inv?.email ?? "";
  }
  let body: { email?: unknown; send?: unknown } = {};
  try { const t = await req.text(); if (t) body = JSON.parse(t); } catch { /* optional body */ }
  if (typeof body.email === "string" && body.email.trim()) email = body.email.trim().toLowerCase();
  if (!email && cast.repId) {
    const rep = await db.select({ email: users.email }).from(users).where(eq(users.id, cast.repId)).get();
    if (rep?.email) { email = rep.email; recipientIsRep = true; }
  }
  if (!email && cast.repInviteId) {
    const repInv = await db.select({ email: invites.email }).from(invites).where(eq(invites.id, cast.repInviteId)).get();
    if (repInv?.email) { email = repInv.email; recipientIsRep = true; }
  }
  if (!email) return NextResponse.json({ error: "Add a contact email for this performer (or assign a rep) first." }, { status: 400 });

  const token = await mintConsentToken({ castId: cast.id, productionId: id, email });
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
  const consentUrl = `${baseUrl}/consent/access/${token}`;

  const companyName = production.organisationId
    ? (await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, production.organisationId)).get())?.name ?? "the production company"
    : "the production company";

  // Email it unless explicitly suppressed (send: false → just return the link).
  if (body.send !== false) {
    const { subject, html } = consentRequestEmail({
      performerName: cast.actorName ?? "there",
      productionName: production.name,
      companyName,
      consentUrl,
      recipientIsRep,
    });
    await sendEmail({ to: email, subject, html }).catch(() => {});
  }

  return NextResponse.json({ ok: true, consentUrl, email, recipientIsRep });
}
