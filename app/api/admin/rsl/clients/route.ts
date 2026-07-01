import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { rslClients, users, royaltySources } from "@/lib/db/schema";

/** Admin view + control of AI licensee clients (the claimable stubs). */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const rows = await db
    .select({
      id: rslClients.id,
      clientName: rslClients.clientName,
      contactEmail: rslClients.contactEmail,
      verified: rslClients.verified,
      blockedAt: rslClients.blockedAt,
      licenseeId: rslClients.licenseeId,
      createdAt: rslClients.createdAt,
      activeSources: sql<number>`(select count(*) from ${royaltySources} rs where rs.client_id = ${rslClients.id} and rs.status = 'active')`,
    })
    .from(rslClients)
    .orderBy(sql`${rslClients.createdAt} desc`)
    .limit(200)
    .all();
  return NextResponse.json({ items: rows });
}

// POST { clientId, action: "block" | "unblock" | "verify" }
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { clientId?: unknown; action?: unknown } = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const clientId = typeof body.clientId === "string" ? body.clientId : null;
  const action = ["block", "unblock", "verify"].includes(body.action as string) ? (body.action as string) : null;
  if (!clientId || !action) return NextResponse.json({ error: "clientId + action required" }, { status: 400 });

  const db = getDb();
  const client = await db.select().from(rslClients).where(eq(rslClients.id, clientId)).get();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const now = Math.floor(Date.now() / 1000);

  if (action === "block") {
    await db.update(rslClients).set({ blockedAt: now, updatedAt: now }).where(eq(rslClients.id, clientId));
    // Blocking also kills the client's live credentials.
    await db
      .update(royaltySources)
      .set({ status: "revoked", revokedAt: now })
      .where(and(eq(royaltySources.clientId, clientId), eq(royaltySources.status, "active")));
  } else if (action === "unblock") {
    await db.update(rslClients).set({ blockedAt: null, updatedAt: now }).where(eq(rslClients.id, clientId));
  } else {
    await db.update(rslClients).set({ verified: true, updatedAt: now }).where(eq(rslClients.id, clientId));
    // Clear the stub's unclaimed marker once verified.
    await db.update(users).set({ unclaimedAt: null }).where(eq(users.id, client.licenseeId));
  }
  return NextResponse.json({ ok: true });
}
