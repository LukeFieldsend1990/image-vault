import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productionCast } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeCastConsent } from "@/lib/consent/authorize";
import { addNegotiationRound } from "@/lib/consent/negotiation";
import { loadConsentDocByCast } from "@/lib/consent/load";
import { createNotification } from "@/lib/notifications/create";

// POST /api/consent/cast/[castId]/negotiation/decline
// Either party ends the pre-negotiation on a placeholder without agreement. The
// cast row is marked declined. Body: { comment?: string }.
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
  const party = auth.party;

  let body: { comment?: unknown } = {};
  try { const t = await req.text(); if (t) body = JSON.parse(t); } catch { /* tolerate empty */ }
  const comment = typeof body.comment === "string" ? body.comment : null;

  await db.update(productionCast).set({ status: "declined" }).where(eq(productionCast.id, castId));
  await addNegotiationRound(db, { castId, party, action: "declined", comment, createdBy: session.sub });

  void (async () => {
    try {
      const vm = await loadConsentDocByCast(db, castId);
      const productionName = vm?.productionName ?? "the production";
      const performerName = vm?.performerName ?? "the performer";
      const note = {
        type: "consent_declined",
        title: party === "producer" ? `${productionName} ended the negotiation` : `${performerName}'s agent declined`,
        body: comment ? `"${comment}"` : `The negotiation on ${productionName} ended without agreement.`,
        href: `/consent/cast/${castId}`,
      };
      if (party === "producer" && auth.cast.repId) {
        await createNotification(db, { userId: auth.cast.repId, ...note });
      } else if (party === "rep") {
        await createNotification(db, { userId: auth.cast.addedBy, ...note });
      }
    } catch { /* best-effort */ }
  })();

  return NextResponse.json({ ok: true });
}
