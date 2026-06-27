import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeLicenceConsent } from "@/lib/consent/authorize";
import { acceptConsentForLicence } from "@/lib/consent/acceptance";
import { listNegotiationRounds, addNegotiationRound } from "@/lib/consent/negotiation";
import { loadConsentDocByLicence } from "@/lib/consent/load";
import { createNotification } from "@/lib/notifications/create";
import { sendEmail } from "@/lib/email/send";
import { consentConfirmedEmail } from "@/lib/email/templates";
import { listUseCategories } from "@/lib/consent/use-categories";

// POST /api/consent/[id]/accept
// Record a registered performer's (or their agent's) consent for a licence.
// Body: { uses: string[], attested: true }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeLicenceConsent(db, session, id);
  if (!auth) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  if (!auth.canAct) return NextResponse.json({ error: "Forbidden — only the performer or their agent can confirm consent" }, { status: 403 });

  let body: { uses?: unknown; attested?: unknown } = {};
  try { body = JSON.parse(await req.text()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (body.attested !== true) return NextResponse.json({ error: "You must confirm the attestation." }, { status: 400 });
  const uses = Array.isArray(body.uses) ? body.uses.filter((u): u is string => typeof u === "string") : [];

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
  const ua = req.headers.get("user-agent");

  const result = await acceptConsentForLicence(db, {
    licenceId: id,
    talentId: auth.licence.talentId,
    actorId: session.sub,
    acceptedByEmail: session.email,
    acceptedByRole: auth.actingRole === "rep" ? "rep" : "talent",
    uses,
    ip,
    ua,
  });

  // If a negotiation was open, confirming accepts the production's current offer —
  // close the thread so the producer's view reflects agreement.
  const rounds = await listNegotiationRounds(db, id);
  if (rounds.length > 0 && rounds[rounds.length - 1].action === "counter") {
    await addNegotiationRound(db, {
      licenceId: id,
      party: auth.actingRole === "rep" ? "rep" : "talent",
      action: "accepted",
      scope: uses,
      fee: rounds[rounds.length - 1].fee,
      comment: null,
      createdBy: session.sub,
    });
  }

  // Notify + email the production (licensee), best-effort.
  void (async () => {
    try {
      const vm = await loadConsentDocByLicence(db, id);
      const licensee = await db.select({ email: users.email }).from(users).where(eq(users.id, auth.licence.licenseeId)).get();
      const total = listUseCategories().length;
      const consentedCount = uses.length;
      const productionName = vm?.productionName ?? "your production";
      const performerName = vm?.performerName ?? "The performer";
      await createNotification(db, {
        userId: auth.licence.licenseeId,
        type: "consent_confirmed",
        title: `${performerName} confirmed consent`,
        body: `${consentedCount} of ${total} uses consented on ${productionName}.`,
        href: `/licences/${id}`,
      });
      if (licensee?.email) {
        const { subject, html } = consentConfirmedEmail({
          recipientEmail: licensee.email,
          performerName,
          productionName,
          consentedCount,
          totalCount: total,
          reviewUrl: `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io"}/licences/${id}`,
        });
        await sendEmail({ to: licensee.email, subject, html });
      }
    } catch { /* best-effort */ }
  })();

  return NextResponse.json({ ok: true, ...result });
}
