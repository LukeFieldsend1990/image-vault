import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeLicenceConsent } from "@/lib/consent/authorize";
import { addNegotiationRound } from "@/lib/consent/negotiation";
import { reconcileTrainingFlag, serializeUseCategoryIds, normaliseUseCategoryIds } from "@/lib/consent/use-categories";
import { loadConsentDocByLicence } from "@/lib/consent/load";
import { createNotification, notifyTalentAndReps } from "@/lib/notifications/create";
import { appendEventBg, licenceChain } from "@/lib/compliance/emit-bg";

// POST /api/consent/[id]/counter
// Propose different terms in the negotiation. Body: { scope: string[], fee?: number|null, comment?: string }.
// Talent/rep counter = a conditional consent (awaits the producer). Producer
// counter = a revised offer (updates the licence so the consent doc reflects it).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeLicenceConsent(db, session, id);
  if (!auth) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  if (!auth.party || auth.party === "admin") {
    // Admins can view but aren't a negotiating party.
    if (!auth.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const party = auth.party === "producer" ? "producer" : auth.party === "rep" ? "rep" : "talent";

  let body: { scope?: unknown; fee?: unknown; comment?: unknown } = {};
  try { body = JSON.parse(await req.text()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const scope = normaliseUseCategoryIds(body.scope);
  const fee = typeof body.fee === "number" ? Math.round(body.fee) : (body.fee === null ? null : undefined);
  const comment = typeof body.comment === "string" ? body.comment : null;

  const round = await addNegotiationRound(db, {
    licenceId: id,
    party,
    action: "counter",
    scope,
    fee: fee ?? null,
    comment,
    createdBy: session.sub,
  });

  // A producer counter revises the standing offer so the consent document the
  // performer sees reflects the new requested scope + fee.
  if (party === "producer") {
    const reconciled = reconcileTrainingFlag({ useCategoryIds: scope, permitAiTraining: false });
    await db
      .update(licences)
      .set({
        useCategoriesJson: serializeUseCategoryIds(reconciled.useCategoryIds),
        permitAiTraining: reconciled.permitAiTraining,
        ...(fee !== undefined ? { proposedFee: fee } : {}),
      })
      .where(eq(licences.id, id));
  }

  // Record the counter-offer in the compliance ledger (negotiation history).
  appendEventBg(db, {
    chainKey: licenceChain(id), eventType: "consent.counter_proposed", clauseRef: "39.B",
    licenceId: id, talentId: auth.licence.talentId, actorId: session.sub,
    payload: { byParty: party, scope, fee: fee ?? null, comment },
  });

  // Notify the other side.
  void (async () => {
    try {
      const vm = await loadConsentDocByLicence(db, id);
      const productionName = vm?.productionName ?? "the production";
      const performerName = vm?.performerName ?? "the performer";
      if (party === "producer") {
        await notifyTalentAndReps(db, auth.licence.talentId, {
          type: "consent_counter",
          title: `${productionName} revised the terms`,
          body: comment ? `"${comment}"` : `Updated terms for ${productionName}. Review and respond.`,
          href: `/consent/${id}`,
        });
      } else {
        const licensee = await db.select({ id: users.id }).from(users).where(eq(users.id, auth.licence.licenseeId)).get();
        if (licensee) {
          await createNotification(db, {
            userId: licensee.id,
            type: "consent_counter",
            title: `${performerName} proposed different terms`,
            body: comment ? `"${comment}"` : `Counter-offer on ${productionName}. Review and respond.`,
            href: `/consent/${id}`,
          });
        }
      }
    } catch { /* best-effort */ }
  })();

  return NextResponse.json({ ok: true, round });
}
