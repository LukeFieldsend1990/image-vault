import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { insurerPolicies } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { resolveInsurerAccess } from "@/lib/compliance/insurer-access";
import { listPolicies, POLICY_LINES, type PolicyLine } from "@/lib/compliance/underwriting";

// GET /api/insurer/productions/[id]/policies → active policies for this production
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const access = await resolveInsurerAccess(db, session, id);
  if (!access.allowed) return NextResponse.json({ error: "No insurer grant for this production" }, { status: 403 });

  return NextResponse.json({ policies: await listPolicies(db, id) });
}

// POST /api/insurer/productions/[id]/policies
// Record a policy the insurer holds against this production. Requires the caller to
// hold the insurer grant (the grant_id the policy binds to), so admins-without-grant
// cannot create one.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const access = await resolveInsurerAccess(db, session, id);
  if (!access.allowed) return NextResponse.json({ error: "No insurer grant for this production" }, { status: 403 });
  if (!access.grantId) {
    return NextResponse.json({ error: "Only the insurer holding the grant can record a policy" }, { status: 403 });
  }

  let body: {
    policyLine?: string;
    policyNumber?: string;
    coverageLimit?: number;
    currency?: string;
    effectiveFrom?: number;
    effectiveTo?: number;
    notes?: string;
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const policyLine = body.policyLine as PolicyLine;
  if (!POLICY_LINES.includes(policyLine)) {
    return NextResponse.json({ error: `policyLine must be one of: ${POLICY_LINES.join(", ")}` }, { status: 400 });
  }
  if (body.effectiveFrom != null && body.effectiveTo != null && body.effectiveTo < body.effectiveFrom) {
    return NextResponse.json({ error: "effectiveTo cannot precede effectiveFrom" }, { status: 400 });
  }
  const coverageLimit =
    typeof body.coverageLimit === "number" && Number.isFinite(body.coverageLimit) && body.coverageLimit >= 0
      ? Math.round(body.coverageLimit)
      : null;

  const policyId = crypto.randomUUID();
  await db.insert(insurerPolicies).values({
    id: policyId,
    grantId: access.grantId,
    productionId: id,
    policyNumber: typeof body.policyNumber === "string" && body.policyNumber.trim() ? body.policyNumber.trim() : null,
    policyLine,
    coverageLimit,
    currency: typeof body.currency === "string" && body.currency.trim() ? body.currency.trim().toUpperCase() : "USD",
    effectiveFrom: typeof body.effectiveFrom === "number" ? Math.round(body.effectiveFrom) : null,
    effectiveTo: typeof body.effectiveTo === "number" ? Math.round(body.effectiveTo) : null,
    notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
    createdBy: session.sub,
    createdAt: Math.floor(Date.now() / 1000),
  });

  return NextResponse.json({ id: policyId }, { status: 201 });
}
