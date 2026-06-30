import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { orgConnections } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import {
  getManagedOrgIds,
  respondConnection,
  counterpartyOrgId,
  isVisibilityTier,
  type ConnectionRow,
  type VisibilityTier,
} from "@/lib/organisations/connections";
import { eq } from "drizzle-orm";

// POST /api/connections/[connId]/respond — the invited org accepts or declines.
// Body { action: 'accept' | 'decline', tier? }. Only the non-initiator party's
// owner/admin may respond.
export async function POST(req: NextRequest, { params }: { params: Promise<{ connId: string }> }) {
  const { connId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { action?: unknown; tier?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = body.action === "accept" || body.action === "decline" ? body.action : null;
  if (!action) return NextResponse.json({ error: "action must be 'accept' or 'decline'" }, { status: 400 });
  const tier: VisibilityTier = isVisibilityTier(body.tier) ? body.tier : "identity";

  const db = getDb();
  const conn = await db.select().from(orgConnections).where(eq(orgConnections.id, connId)).get();
  if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The responder is the non-initiator party; the caller must manage it.
  const responderOrgId = counterpartyOrgId(conn as ConnectionRow, conn.initiatedByOrgId);
  const managed = await getManagedOrgIds(db, session.sub);
  if (!responderOrgId || !managed.includes(responderOrgId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await respondConnection(db, { connectionId: connId, responderOrgId, userId: session.sub, action, tier });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
  return NextResponse.json({ ok: true });
}
