import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeCastConsent } from "@/lib/consent/authorize";
import { listCastNegotiationRounds, latestTalentCounter, isThreadClosed } from "@/lib/consent/negotiation";
import { getCastOffer } from "@/lib/consent/cast-offer";

// GET /api/consent/cast/[castId]/negotiation
// The pre-negotiation thread + the production's current offer for a placeholder.
// The current offer is the cast row's stored §39 scope/fee (not a licence).
export async function GET(req: NextRequest, { params }: { params: Promise<{ castId: string }> }) {
  const { castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeCastConsent(db, session, castId);
  if (!auth) return NextResponse.json({ error: "This reserved role no longer exists." }, { status: 404 });
  if (!auth.canView) return NextResponse.json({ error: "This role is not assigned to you." }, { status: 403 });

  const offer = await getCastOffer(db, castId, auth.cast.productionId);
  const rounds = await listCastNegotiationRounds(db, castId);
  const talentCounter = latestTalentCounter(rounds);
  const closed = isThreadClosed(rounds) || auth.cast.status === "declined";

  return NextResponse.json({
    party: auth.party,
    currentOffer: { scope: offer.scope, fee: offer.fee },
    rounds,
    pendingTalentCounter: talentCounter,
    closed,
  });
}
