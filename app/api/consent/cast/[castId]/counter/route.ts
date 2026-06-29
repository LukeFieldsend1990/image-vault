import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeCastConsent } from "@/lib/consent/authorize";
import { addNegotiationRound } from "@/lib/consent/negotiation";
import { applyCastOfferScope } from "@/lib/consent/cast-offer";
import { normaliseUseCategoryIds } from "@/lib/consent/use-categories";
import { loadConsentDocByCast } from "@/lib/consent/load";
import { createNotification } from "@/lib/notifications/create";

// POST /api/consent/cast/[castId]/counter
// Propose different §39 terms during rep pre-negotiation on a placeholder.
// Body: { scope: string[], fee?: number|null, comment?: string }.
// A producer counter revises the stored offer (so the document reflects it);
// a rep counter is a conditional proposal awaiting the producer.
export async function POST(req: NextRequest, { params }: { params: Promise<{ castId: string }> }) {
  const { castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeCastConsent(db, session, castId);
  if (!auth) return NextResponse.json({ error: "This reserved role no longer exists." }, { status: 404 });
  if (auth.party !== "producer" && auth.party !== "rep") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (auth.cast.status === "consented" || auth.cast.status === "declined") {
    return NextResponse.json({ error: "This consent flow is already closed." }, { status: 409 });
  }
  const party = auth.party; // "producer" | "rep"

  let body: { scope?: unknown; fee?: unknown; comment?: unknown } = {};
  try { body = JSON.parse(await req.text()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const scope = normaliseUseCategoryIds(body.scope);
  const fee = typeof body.fee === "number" ? Math.round(body.fee) : (body.fee === null ? null : undefined);
  const comment = typeof body.comment === "string" ? body.comment : null;

  const round = await addNegotiationRound(db, {
    castId,
    party,
    action: "counter",
    scope,
    fee: fee ?? null,
    comment,
    createdBy: session.sub,
  });

  // A producer counter revises the standing offer so the document the performer
  // is eventually sent reflects the new requested scope + fee.
  if (party === "producer") {
    await applyCastOfferScope(db, castId, scope, fee);
  }

  // Notify the other side.
  void (async () => {
    try {
      const vm = await loadConsentDocByCast(db, castId);
      const productionName = vm?.productionName ?? "the production";
      const performerName = vm?.performerName ?? "the performer";
      if (party === "producer" && auth.cast.repId) {
        await createNotification(db, {
          userId: auth.cast.repId,
          type: "consent_counter",
          title: `${productionName} revised the terms`,
          body: comment ? `"${comment}"` : `Updated terms for ${performerName} on ${productionName}. Review and respond.`,
          href: `/consent/cast/${castId}`,
        });
      } else if (party === "rep") {
        await createNotification(db, {
          userId: auth.cast.addedBy,
          type: "consent_counter",
          title: `${performerName}'s agent proposed different terms`,
          body: comment ? `"${comment}"` : `Counter-offer on ${productionName}. Review and respond.`,
          href: `/consent/cast/${castId}`,
        });
      }
    } catch { /* best-effort */ }
  })();

  return NextResponse.json({ ok: true, round });
}
