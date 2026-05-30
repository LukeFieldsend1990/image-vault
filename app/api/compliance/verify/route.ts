export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeScope } from "@/lib/compliance/access";
import { verifyCertificate } from "@/lib/compliance/certificate";
import { complianceCertificates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { CertScope } from "@/lib/compliance/certificate";

// GET /api/compliance/verify?certificateId= — recompute the ledger and compare to
// the certificate's sealed tip hash. ok:false ⇒ the ledger was altered after issuance.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const certificateId = new URL(req.url).searchParams.get("certificateId") ?? "";
  if (!certificateId) return NextResponse.json({ error: "certificateId is required" }, { status: 400 });

  const db = getDb();
  const cert = await db
    .select({ scope: complianceCertificates.scope, scopeId: complianceCertificates.scopeId })
    .from(complianceCertificates)
    .where(eq(complianceCertificates.id, certificateId))
    .get();
  if (!cert) return NextResponse.json({ error: "Certificate not found" }, { status: 404 });

  const auth = await authorizeScope(db, session, cert.scope as CertScope, cert.scopeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const result = await verifyCertificate(db, certificateId);
  if (!result) return NextResponse.json({ error: "Certificate not found" }, { status: 404 });

  return NextResponse.json(result);
}
