export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { complianceCertificates } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { resolveInsurerAccess } from "@/lib/compliance/insurer-access";
import { and, eq, desc } from "drizzle-orm";

// GET /api/insurer/productions/[id]/certificates
// Previously-generated signed certificates for this production (the HTML twins of
// the claims evidence pack). Read-only; gated by an active insurer grant.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const access = await resolveInsurerAccess(db, session, id);
  if (!access.allowed) return NextResponse.json({ error: "No insurer grant for this production" }, { status: 403 });

  const certs = await db
    .select({
      id: complianceCertificates.id,
      regime: complianceCertificates.regime,
      ledgerTipHash: complianceCertificates.ledgerTipHash,
      eventCount: complianceCertificates.eventCount,
      generatedAt: complianceCertificates.generatedAt,
    })
    .from(complianceCertificates)
    .where(and(eq(complianceCertificates.scope, "production"), eq(complianceCertificates.scopeId, id)))
    .orderBy(desc(complianceCertificates.generatedAt))
    .all();

  return NextResponse.json({ certificates: certs });
}
