import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import {
  dismissAppendFailure,
  listAppendFailures,
  replayAppendFailure,
  type AppendFailure,
} from "@/lib/compliance/failures";

export interface LedgerFailuresResponse {
  failures: AppendFailure[];
  unresolvedCount: number;
}

// GET /api/admin/ledger-failures?status=unresolved
// Ledger appends that could not be written. A dropped append is invisible in the
// chain itself, so this list is the only record that one occurred.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const status = new URL(req.url).searchParams.get("status");
  const db = getDb();

  const failures = await listAppendFailures(db, {
    status: status === "replayed" || status === "dismissed" || status === "unresolved" ? status : undefined,
    limit: 200,
  });
  const unresolved = await listAppendFailures(db, { status: "unresolved", limit: 200 });

  const response: LedgerFailuresResponse = { failures, unresolvedCount: unresolved.length };
  return NextResponse.json(response);
}

// POST /api/admin/ledger-failures
// Body: { id, action: "replay" | "dismiss", note? }
//
// Replay appends the event at the chain's current tip — an append-only chain
// cannot take an insertion at the position the event would originally have had.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { id?: unknown; action?: unknown; note?: unknown } = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const action = body.action;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = getDb();

  if (action === "replay") {
    const result = await replayAppendFailure(db, id, session.sub);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, seq: result.seq, hash: result.hash });
  }

  if (action === "dismiss") {
    const note = typeof body.note === "string" ? body.note.trim() : "";
    // A dismissal is a claim that the event does not need to exist on the chain.
    // That claim should carry a reason, so the next reader of this table can tell
    // a resolved problem from an ignored one.
    if (!note) return NextResponse.json({ error: "A reason is required to dismiss" }, { status: 400 });
    const ok = await dismissAppendFailure(db, id, session.sub, note);
    if (!ok) return NextResponse.json({ error: "No unresolved failure with that id" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "action must be 'replay' or 'dismiss'" }, { status: 400 });
}
