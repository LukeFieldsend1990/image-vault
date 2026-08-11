import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { updateOffenderAccount, type OffenderStatus } from "@/lib/monitor/accounts";

const STATUSES: OffenderStatus[] = ["watchlist", "reported", "suspended", "cleared"];

// PATCH /api/monitor/accounts/:id — move an offender case file along.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can update offender accounts" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { status?: string; notes?: string };

  if (body.status && !STATUSES.includes(body.status as OffenderStatus)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  }
  if (!body.status && typeof body.notes !== "string") {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const db = getDb();
  const ok = await updateOffenderAccount(db, id, session.sub, {
    status: body.status as OffenderStatus | undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
  });
  if (!ok) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
