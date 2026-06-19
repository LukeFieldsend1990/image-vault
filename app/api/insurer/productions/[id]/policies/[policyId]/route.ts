import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { insurerPolicies } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { resolveInsurerAccess } from "@/lib/compliance/insurer-access";
import { and, eq, isNull } from "drizzle-orm";

// DELETE /api/insurer/productions/[id]/policies/[policyId]
// Soft-archive a policy (mirrors policy end). Gated by an insurer grant on the
// production; the policy must belong to that production.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  const { id, policyId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const access = await resolveInsurerAccess(db, session, id);
  if (!access.allowed) return NextResponse.json({ error: "No insurer grant for this production" }, { status: 403 });
  if (!access.grantId) {
    return NextResponse.json({ error: "Only the insurer holding the grant can archive a policy" }, { status: 403 });
  }

  const row = await db
    .select({ id: insurerPolicies.id })
    .from(insurerPolicies)
    .where(
      and(
        eq(insurerPolicies.id, policyId),
        eq(insurerPolicies.productionId, id),
        isNull(insurerPolicies.archivedAt),
      ),
    )
    .get();
  if (!row) return NextResponse.json({ error: "Policy not found" }, { status: 404 });

  await db
    .update(insurerPolicies)
    .set({ archivedAt: Math.floor(Date.now() / 1000) })
    .where(eq(insurerPolicies.id, policyId));

  return NextResponse.json({ ok: true });
}
