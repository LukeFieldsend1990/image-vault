import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeCastConsent } from "@/lib/consent/authorize";
import { listCastNegotiationRounds, latestTalentCounter, addNegotiationRound } from "@/lib/consent/negotiation";
import { applyCastOfferScope } from "@/lib/consent/cast-offer";
import { loadConsentDocByCast } from "@/lib/consent/load";
import { createNotification } from "@/lib/notifications/create";

// POST /api/consent/cast/[castId]/negotiation/accept
// The production accepts the rep's latest counter on a placeholder: apply the
// agreed scope + fee to the stored offer so the document the performer is sent
// reflects it, and close the pre-negotiation thread. Producer (or admin) only.
// This does NOT record the performer's consent — that happens when the rep sends
// the document and the performer confirms via the tokenised link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ castId: string }> }) {
  const { castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeCastConsent(db, session, castId);
  if (!auth) return NextResponse.json({ error: "This reserved role no longer exists." }, { status: 404 });
  if (!(auth.party === "producer" || auth.party === "admin")) {
    return NextResponse.json({ error: "Forbidden — only the production can accept a counter-offer." }, { status: 403 });
  }

  const rounds = await listCastNegotiationRounds(db, castId);
  const counter = latestTalentCounter(rounds);
  if (!counter) return NextResponse.json({ error: "There is no open counter-offer to accept." }, { status: 409 });

  await applyCastOfferScope(db, castId, counter.scope, counter.fee);
  await addNegotiationRound(db, {
    castId,
    party: "producer",
    action: "accepted",
    scope: counter.scope,
    fee: counter.fee,
    comment: null,
    createdBy: session.sub,
  });

  void (async () => {
    try {
      const vm = await loadConsentDocByCast(db, castId);
      if (auth.cast.repId) {
        await createNotification(db, {
          userId: auth.cast.repId,
          type: "consent_agreed",
          title: `Terms agreed on ${vm?.productionName ?? "the production"}`,
          body: `The production accepted your terms. You can now send the consent document for final sign-off.`,
          href: `/consent/cast/${castId}`,
        });
      }
    } catch { /* best-effort */ }
  })();

  return NextResponse.json({ ok: true, agreedScope: counter.scope, agreedFee: counter.fee });
}
