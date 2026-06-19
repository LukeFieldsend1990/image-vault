import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { complianceCertificates, complianceEvents, replicaTransfers, strikeLocks } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

// GET /api/compliance/overview — admin cockpit data: active strikes, pending
// transfers, recent ledger events, recent certificates.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();

  const [strikes, pendingTransfers, recentEvents, certificates] = await Promise.all([
    db.select().from(strikeLocks).orderBy(desc(strikeLocks.declaredAt)).limit(50).all(),
    db.select().from(replicaTransfers).where(eq(replicaTransfers.status, "requested")).orderBy(desc(replicaTransfers.createdAt)).limit(50).all(),
    db
      .select({
        id: complianceEvents.id,
        eventType: complianceEvents.eventType,
        clauseRef: complianceEvents.clauseRef,
        licenceId: complianceEvents.licenceId,
        createdAt: complianceEvents.createdAt,
      })
      .from(complianceEvents)
      .orderBy(desc(complianceEvents.createdAt))
      .limit(50)
      .all(),
    db.select().from(complianceCertificates).orderBy(desc(complianceCertificates.generatedAt)).limit(25).all(),
  ]);

  return NextResponse.json({ strikes, pendingTransfers, recentEvents, certificates });
}
