import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, productionCast, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeLicenceConsent } from "@/lib/consent/authorize";
import { addNegotiationRound } from "@/lib/consent/negotiation";
import { loadConsentDocByLicence } from "@/lib/consent/load";
import { createNotification } from "@/lib/notifications/create";

// POST /api/consent/[id]/negotiation/decline
// Either party ends the negotiation without agreement. Marks the licence DENIED
// and the cast row declined. Body: { comment?: string }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeLicenceConsent(db, session, id);
  if (!auth) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  if (!auth.party) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const party = auth.party === "producer" ? "producer" : auth.party === "rep" ? "rep" : "talent";

  let body: { comment?: unknown } = {};
  try { const t = await req.text(); if (t) body = JSON.parse(t); } catch { /* tolerate empty */ }
  const comment = typeof body.comment === "string" ? body.comment : null;

  await db.update(licences).set({ status: "DENIED" }).where(eq(licences.id, id));
  await db.update(productionCast).set({ status: "declined" }).where(eq(productionCast.licenceId, id));
  await addNegotiationRound(db, { licenceId: id, party, action: "declined", comment, createdBy: session.sub });

  void (async () => {
    try {
      const vm = await loadConsentDocByLicence(db, id);
      const productionName = vm?.productionName ?? "the production";
      const performerName = vm?.performerName ?? "the performer";
      // Notify the *other* side.
      const recipientId = party === "producer" ? auth.licence.talentId : auth.licence.licenseeId;
      const recipient = await db.select({ id: users.id }).from(users).where(eq(users.id, recipientId)).get();
      if (recipient) {
        await createNotification(db, {
          userId: recipient.id,
          type: "consent_declined",
          title: party === "producer" ? `${productionName} ended the negotiation` : `${performerName} declined`,
          body: comment ? `"${comment}"` : `The negotiation on ${productionName} ended without agreement.`,
          href: `/consent/${id}`,
        });
      }
    } catch { /* best-effort */ }
  })();

  return NextResponse.json({ ok: true });
}
