import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { accountOutreach, monitorAccounts } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { desc, eq, and } from "drizzle-orm";

const METHODS = new Set(["dm", "email", "manual"]);
const PURPOSES = new Set(["licence_offer", "consent_request", "takedown_request", "other"]);

// GET /api/monitor/accounts/:id/outreach — history for this account, most
// recent first. Used by the Contact modal to show "you already messaged
// this account 3 days ago" before the operator writes a second time.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can view outreach history" }, { status: 403 });
  }

  const { id: accountId } = await params;
  const db = getDb();

  const rows = await db
    .select()
    .from(accountOutreach)
    .where(and(eq(accountOutreach.accountId, accountId), eq(accountOutreach.talentId, session.sub)))
    .orderBy(desc(accountOutreach.firstContactAt))
    .limit(10)
    .all();

  return NextResponse.json({ outreach: rows });
}

// POST /api/monitor/accounts/:id/outreach — log a new outreach. Body:
// { method, purpose, messageBody, notes? }. We do not send the message;
// the operator has already sent it via the platform DM surface and clicks
// "Mark sent" to record it here.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can log outreach" }, { status: 403 });
  }

  const { id: accountId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    method?: string;
    purpose?: string;
    messageBody?: string;
    notes?: string;
  };

  if (!body.method || !METHODS.has(body.method)) {
    return NextResponse.json({ error: "method must be dm | email | manual" }, { status: 400 });
  }
  if (!body.purpose || !PURPOSES.has(body.purpose)) {
    return NextResponse.json(
      { error: "purpose must be licence_offer | consent_request | takedown_request | other" },
      { status: 400 }
    );
  }
  if (!body.messageBody?.trim()) {
    return NextResponse.json({ error: "messageBody required" }, { status: 400 });
  }

  const db = getDb();
  const account = await db.select({ id: monitorAccounts.id }).from(monitorAccounts).where(eq(monitorAccounts.id, accountId)).get();
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await db.insert(accountOutreach).values({
    id,
    accountId,
    talentId: session.sub,
    initiatedBy: session.sub,
    method: body.method as "dm" | "email" | "manual",
    purpose: body.purpose as "licence_offer" | "consent_request" | "takedown_request" | "other",
    messageBody: body.messageBody.trim().slice(0, 5000),
    status: "sent",
    firstContactAt: now,
    lastStatusAt: now,
    notes: body.notes?.trim() ? body.notes.trim().slice(0, 500) : null,
  });

  return NextResponse.json({ ok: true, id });
}
