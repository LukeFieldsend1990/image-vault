import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { orgConnections } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import {
  getManagedOrgIds,
  revokeConnection,
  setOwnTier,
  isVisibilityTier,
} from "@/lib/organisations/connections";
import { eq } from "drizzle-orm";

// The caller's managed org that is a party to this connection, or null.
async function callerPartyOrg(db: ReturnType<typeof getDb>, userId: string, connId: string) {
  const conn = await db.select().from(orgConnections).where(eq(orgConnections.id, connId)).get();
  if (!conn) return { conn: null as null, orgId: null as string | null };
  const managed = await getManagedOrgIds(db, userId);
  const orgId = managed.find((m) => m === conn.orgAId || m === conn.orgBId) ?? null;
  return { conn, orgId };
}

// PATCH /api/connections/[connId] — change the tier YOUR org exposes. Body { tier }.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ connId: string }> }) {
  const { connId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { tier?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isVisibilityTier(body.tier)) return NextResponse.json({ error: "Invalid tier" }, { status: 400 });

  const db = getDb();
  const { conn, orgId } = await callerPartyOrg(db, session.sub, connId);
  if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await setOwnTier(db, { connectionId: connId, orgId, tier: body.tier });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/connections/[connId] — disconnect. Either party's owner/admin.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ connId: string }> }) {
  const { connId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const { conn, orgId } = await callerPartyOrg(db, session.sub, connId);
  if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await revokeConnection(db, { connectionId: connId, orgId, userId: session.sub });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
  return NextResponse.json({ ok: true });
}
