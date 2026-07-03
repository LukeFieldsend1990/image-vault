import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  productionCast,
  productions,
  organisationMembers,
  invites,
  organisations,
  users,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { productionCastInviteEmail } from "@/lib/email/templates";

// POST /api/productions/[id]/cast/[castId]/resend-invite
// Resend the invite email for a cast member with status 'invited'.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; castId: string }> }
) {
  const { id, castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const production = await db
    .select({
      id: productions.id,
      name: productions.name,
      organisationId: productions.organisationId,
    })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  // Auth check
  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, production.organisationId),
            eq(organisationMembers.userId, session.sub)
          )
        )
        .get();
      if (!membership || (membership.memberRole !== "owner" && membership.memberRole !== "admin")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  const castRow = await db
    .select()
    .from(productionCast)
    .where(and(eq(productionCast.id, castId), eq(productionCast.productionId, id)))
    .get();
  if (!castRow) return NextResponse.json({ error: "Cast member not found" }, { status: 404 });

  if (castRow.status !== "invited" || !castRow.inviteId) {
    return NextResponse.json(
      { error: "This cast member does not have a pending invite" },
      { status: 404 }
    );
  }

  const invite = await db
    .select()
    .from(invites)
    .where(eq(invites.id, castRow.inviteId))
    .get();
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  // Parse licence terms for the email
  let licenceTerms: {
    intendedUse?: string;
    validFrom?: number;
    validTo?: number;
  } = {};
  if (castRow.licenceTermsJson) {
    try {
      licenceTerms = JSON.parse(castRow.licenceTermsJson);
    } catch {
      // ignore parse errors — send with fallback values
    }
  }

  // Get company name
  const org = production.organisationId
    ? await db
        .select({ name: organisations.name })
        .from(organisations)
        .where(eq(organisations.id, production.organisationId))
        .get()
    : null;
  const companyName = org?.name ?? "Production Company";

  const coordinatorUser = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();
  const coordinatorEmail = coordinatorUser?.email ?? session.email;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";

  // Re-send email using existing invite ID
  void (async () => {
    const { subject, html } = productionCastInviteEmail({
      recipientEmail: invite.email,
      productionName: production.name,
      companyName,
      coordinatorEmail,
      characterName: castRow.characterName ?? undefined,
      intendedUse: licenceTerms.intendedUse ?? "Production use",
      validFrom: licenceTerms.validFrom ?? Math.floor(Date.now() / 1000),
      validTo: licenceTerms.validTo ?? Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
      signupUrl: `${baseUrl}/signup?invite=${invite.id}`,
    });
    await sendEmail({ to: invite.email, subject, html });
  })();

  return NextResponse.json({ ok: true });
}
