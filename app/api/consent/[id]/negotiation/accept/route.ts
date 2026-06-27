import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeLicenceConsent } from "@/lib/consent/authorize";
import { listNegotiationRounds, latestTalentCounter, addNegotiationRound } from "@/lib/consent/negotiation";
import { reconcileTrainingFlag, serializeUseCategoryIds } from "@/lib/consent/use-categories";
import { acceptConsentForLicence } from "@/lib/consent/acceptance";
import { loadConsentDocByLicence } from "@/lib/consent/load";
import { createNotification } from "@/lib/notifications/create";

// POST /api/consent/[id]/negotiation/accept
// The production accepts the performer's latest counter: apply the countered
// scope + fee to the licence and finalise consent (the counter was a conditional
// consent). Producer/licensee or admin only.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeLicenceConsent(db, session, id);
  if (!auth) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  if (!(auth.isLicensee || auth.party === "admin")) {
    return NextResponse.json({ error: "Forbidden — only the production can accept a counter-offer." }, { status: 403 });
  }

  const rounds = await listNegotiationRounds(db, id);
  const counter = latestTalentCounter(rounds);
  if (!counter) return NextResponse.json({ error: "There is no open counter-offer to accept." }, { status: 409 });

  // Apply the agreed terms to the licence.
  const reconciled = reconcileTrainingFlag({ useCategoryIds: counter.scope, permitAiTraining: false });
  await db
    .update(licences)
    .set({
      useCategoriesJson: serializeUseCategoryIds(reconciled.useCategoryIds),
      permitAiTraining: reconciled.permitAiTraining,
      proposedFee: counter.fee,
    })
    .where(eq(licences.id, id));

  // The counter was a conditional consent — finalise it on the performer's behalf.
  await acceptConsentForLicence(db, {
    licenceId: id,
    talentId: auth.licence.talentId,
    actorId: session.sub,
    acceptedByEmail: session.email,
    acceptedByRole: counter.party === "rep" ? "rep" : "talent",
    uses: reconciled.useCategoryIds,
  });

  await addNegotiationRound(db, {
    licenceId: id,
    party: "producer",
    action: "accepted",
    scope: reconciled.useCategoryIds,
    fee: counter.fee,
    comment: null,
    createdBy: session.sub,
  });

  void (async () => {
    try {
      const vm = await loadConsentDocByLicence(db, id);
      await createNotification(db, {
        userId: auth.licence.talentId,
        type: "consent_agreed",
        title: `Terms agreed on ${vm?.productionName ?? "the production"}`,
        body: `The production accepted your terms. Consent is recorded.`,
        href: `/consent/${id}`,
      });
    } catch { /* best-effort */ }
  })();

  return NextResponse.json({ ok: true, agreedScope: reconciled.useCategoryIds, agreedFee: counter.fee });
}
