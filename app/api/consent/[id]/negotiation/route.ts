import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeLicenceConsent } from "@/lib/consent/authorize";
import { listNegotiationRounds, latestTalentCounter, isThreadClosed } from "@/lib/consent/negotiation";
import { parseUseCategoryIds } from "@/lib/consent/use-categories";

// GET /api/consent/[id]/negotiation
// The negotiation thread + the production's current offer. Any participant.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeLicenceConsent(db, session, id);
  if (!auth) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  if (!auth.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const lic = await db
    .select({ useCategoriesJson: licences.useCategoriesJson, proposedFee: licences.proposedFee, status: licences.status })
    .from(licences)
    .where(eq(licences.id, id))
    .get();

  const rounds = await listNegotiationRounds(db, id);
  const talentCounter = latestTalentCounter(rounds);
  const closed = isThreadClosed(rounds) || lic?.status === "DENIED";

  return NextResponse.json({
    party: auth.party,
    currentOffer: {
      scope: parseUseCategoryIds(lic?.useCategoriesJson),
      fee: lic?.proposedFee ?? null,
    },
    rounds,
    // The producer can accept/counter/decline while a talent counter is open.
    pendingTalentCounter: talentCounter,
    closed,
  });
}
