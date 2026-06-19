export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { backfillAllApprovedLicences } from "@/lib/compliance/backfill";

// POST /api/admin/compliance-backfill
// Idempotently append any approval-derived ledger events (39.B consent, 39.E
// biometric isolation, 39.H security custody, 39.J business reason, and 39.C
// where usage exists) missing from approved licences. Heals records whose
// fire-and-forget approval writes were dropped before the response returned, so
// rep/talent-approved licences stop showing those obligations as false gaps.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const result = await backfillAllApprovedLicences(db);
  return NextResponse.json({ ok: true, ...result });
}
