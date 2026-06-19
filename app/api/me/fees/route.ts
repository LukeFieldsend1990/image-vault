import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { feeObligations, talentSettings, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, or, desc } from "drizzle-orm";

// GET /api/me/fees — the caller's own fee obligations.
// Hard-gated by users.financial_visibility_enabled: if the flag is off the
// endpoint returns nothing financial at all, so the model stays invisible
// to talent while it's under test.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const me = await db
    .select({ financialVisibilityEnabled: users.financialVisibilityEnabled })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();

  if (!me?.financialVisibilityEnabled) {
    return NextResponse.json({ visible: false, obligations: [], tier: null });
  }

  const [obligations, settings] = await Promise.all([
    db
      .select({
        id: feeObligations.id,
        type: feeObligations.type,
        tier: feeObligations.tier,
        band: feeObligations.band,
        amountCents: feeObligations.amountCents,
        currency: feeObligations.currency,
        status: feeObligations.status,
        graceDeadline: feeObligations.graceDeadline,
        createdAt: feeObligations.createdAt,
      })
      .from(feeObligations)
      .where(or(eq(feeObligations.talentId, session.sub), eq(feeObligations.payerUserId, session.sub)))
      .orderBy(desc(feeObligations.createdAt))
      .all(),
    db.select({ tier: talentSettings.tier }).from(talentSettings).where(eq(talentSettings.talentId, session.sub)).get(),
  ]);

  return NextResponse.json({ visible: true, tier: settings?.tier ?? null, obligations });
}
