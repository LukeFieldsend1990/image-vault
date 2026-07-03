import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, licences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeLicenceConsent } from "@/lib/consent/authorize";
import { acceptConsentForLicence } from "@/lib/consent/acceptance";
import { listNegotiationRounds, addNegotiationRound } from "@/lib/consent/negotiation";
import { loadConsentDocByLicence } from "@/lib/consent/load";
import { createNotification } from "@/lib/notifications/create";
import { sendEmail } from "@/lib/email/send";
import { consentConfirmedEmail } from "@/lib/email/templates";
import { listUseCategories, parseUseCategoryIds, normaliseUseCategoryIds } from "@/lib/consent/use-categories";

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

// POST /api/consent/[id]/accept
// The performer (or their agent) responds to the production's offer. If their
// ticked uses MATCH what was requested, consent is finalised immediately. If
// they tick a DIFFERENT set, that's a counter-offer — it routes to the producer
// for agreement (same as "Propose different terms"), and consent is not recorded
// until the producer accepts.
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
  const uses = normaliseUseCategoryIds(Array.isArray(body.uses) ? body.uses : []);

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
  const ua = req.headers.get("user-agent");

  const party = auth.actingRole === "rep" ? "rep" : "talent";
  const lic = await db
    .select({ useCategoriesJson: licences.useCategoriesJson, proposedFee: licences.proposedFee })
    .from(licences)
    .where(eq(licences.id, id))
    .get();
  const requested = parseUseCategoryIds(lic?.useCategoriesJson);

  // Deviating from the requested scope = proposing different terms → producer must
  // agree. (Only when there *was* a specific ask to deviate from.)
  const isCounter = requested.length > 0 && !sameSet(requested, uses);

  if (isCounter) {
    const round = await addNegotiationRound(db, {
      licenceId: id,
      party,
      action: "counter",
      scope: uses,
      fee: lic?.proposedFee ?? null,
      comment: null,
      createdBy: session.sub,
    });
    void (async () => {
      try {
        const vm = await loadConsentDocByLicence(db, id);
        await createNotification(db, {
          userId: auth.licence.licenseeId,
          type: "consent_counter",
          title: `${vm?.performerName ?? "The performer"} proposed different terms`,
          body: `Different consent scope on ${vm?.productionName ?? "your production"} — review and respond.`,
          href: `/consent/${id}`,
        });
      } catch { /* best-effort */ }
    })();
    return NextResponse.json({ ok: true, countered: true, round });
  }

  // Scope matches the request → finalise consent now.
  const result = await acceptConsentForLicence(db, {
    licenceId: id,
    talentId: auth.licence.talentId,
    actorId: session.sub,
    acceptedByEmail: session.email,
    acceptedByRole: party,
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
      party,
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
          reviewUrl: `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai"}/licences/${id}`,
        });
        await sendEmail({ to: licensee.email, subject, html });
      }
    } catch { /* best-effort */ }
  })();

  return NextResponse.json({ ok: true, ...result });
}
