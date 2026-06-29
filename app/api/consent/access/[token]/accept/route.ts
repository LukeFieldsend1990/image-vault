import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productionCast, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { verifyConsentToken } from "@/lib/consent/token";
import { acceptConsentForCast } from "@/lib/consent/acceptance";
import { addNegotiationRound } from "@/lib/consent/negotiation";
import { getCastOffer } from "@/lib/consent/cast-offer";
import { loadConsentDocByCast } from "@/lib/consent/load";
import { createNotification } from "@/lib/notifications/create";
import { sendEmail } from "@/lib/email/send";
import { consentConfirmedEmail } from "@/lib/email/templates";
import { listUseCategories, normaliseUseCategoryIds } from "@/lib/consent/use-categories";

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

// POST /api/consent/access/[token]/accept
// PUBLIC — an unregistered performer responds to the request via the tokenised
// link. Body: { uses: string[], attested: true }.
//
// Same rule as the registered surface: if the ticked uses MATCH what was
// requested, consent is finalised (cast row → consented, ledger written at
// registration). If they tick a DIFFERENT set, that's a counter-offer — it is
// recorded on the cast negotiation thread (party "talent") and routed to the
// production/agent for agreement; consent is NOT recorded until the offer matches.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await verifyConsentToken(token);
  if (!data) return NextResponse.json({ error: "This consent link is invalid or has expired." }, { status: 404 });

  let body: { uses?: unknown; attested?: unknown } = {};
  try { body = JSON.parse(await req.text()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (body.attested !== true) return NextResponse.json({ error: "You must confirm the attestation." }, { status: 400 });
  const uses = normaliseUseCategoryIds(Array.isArray(body.uses) ? body.uses : []);

  const db = getDb();
  const cast = await db
    .select({ id: productionCast.id, status: productionCast.status, addedBy: productionCast.addedBy, repId: productionCast.repId })
    .from(productionCast)
    .where(eq(productionCast.id, data.castId))
    .get();
  if (!cast) return NextResponse.json({ error: "This consent request no longer exists." }, { status: 404 });
  // Idempotency — a re-opened token / stale tab must not double-record consent.
  if (cast.status === "consented") return NextResponse.json({ ok: true, alreadyAccepted: true });

  // Deviating from the requested scope = proposing different terms (same logic as
  // the registered consent surface). Only when there *was* a specific ask.
  const offer = await getCastOffer(db, data.castId, data.productionId);
  const isCounter = offer.scope.length > 0 && !sameSet(offer.scope, uses);

  if (isCounter) {
    const round = await addNegotiationRound(db, {
      castId: data.castId,
      party: "talent",
      action: "counter",
      scope: uses,
      fee: offer.fee,
      comment: null,
      createdBy: null, // unregistered performer — no user id yet
    });
    void (async () => {
      try {
        const vm = await loadConsentDocByCast(db, data.castId);
        const performerName = vm?.performerName ?? "The performer";
        const productionName = vm?.productionName ?? "your production";
        const note = {
          type: "consent_counter",
          title: `${performerName} proposed different terms`,
          body: `Different consent scope on ${productionName} — review and respond.`,
          href: `/consent/cast/${data.castId}`,
        };
        await createNotification(db, { userId: cast.addedBy, ...note });
        if (cast.repId) await createNotification(db, { userId: cast.repId, ...note });
      } catch { /* best-effort */ }
    })();
    return NextResponse.json({ ok: true, countered: true, round });
  }

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
  const ua = req.headers.get("user-agent");

  const result = await acceptConsentForCast(db, {
    castId: data.castId,
    acceptedByEmail: data.email,
    uses,
    ip,
    ua,
  });

  void (async () => {
    try {
      const vm = await loadConsentDocByCast(db, data.castId);
      const coordinator = await db.select({ email: users.email }).from(users).where(eq(users.id, cast.addedBy)).get();
      const total = listUseCategories().length;
      const performerName = vm?.performerName ?? "The performer";
      const productionName = vm?.productionName ?? "your production";
      await createNotification(db, {
        userId: cast.addedBy,
        type: "consent_confirmed",
        title: `${performerName} confirmed consent`,
        body: `${uses.length} of ${total} uses consented on ${productionName}.`,
        href: `/productions/${data.productionId}#cast`,
      });
      if (coordinator?.email) {
        const { subject, html } = consentConfirmedEmail({
          recipientEmail: coordinator.email,
          performerName,
          productionName,
          consentedCount: uses.length,
          totalCount: total,
          reviewUrl: `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io"}/productions/${data.productionId}#cast`,
        });
        await sendEmail({ to: coordinator.email, subject, html });
      }
    } catch { /* best-effort */ }
  })();

  return NextResponse.json({ ok: true, ...result });
}
