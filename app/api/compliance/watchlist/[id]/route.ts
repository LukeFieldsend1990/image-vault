import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getUnionIdsForUser } from "@/lib/compliance/grants";
import { archiveWatchlistEntry, getWatchlistEntryUnionId, updateWatchlistEntry } from "@/lib/compliance/watchlist";

// PATCH  /api/compliance/watchlist/:id — edit / flag for outreach.
// DELETE /api/compliance/watchlist/:id — archive (soft remove) the entry.
//
// Per-union scoped: a watcher may only touch entries on their own union's list.
// Admins may touch any entry. Legacy entries with no union_id are admin-only.

async function authorise(
  db: ReturnType<typeof getDb>,
  session: { sub: string; email: string },
  entryId: string,
): Promise<NextResponse | null> {
  const entryUnionId = await getWatchlistEntryUnionId(db, entryId);
  if (entryUnionId === undefined) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  if (isAdmin(session.email)) return null;
  const allowed = await getUnionIdsForUser(db, session.sub, { scopes: ["platform", "union"] });
  if (allowed.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!entryUnionId || !allowed.includes(entryUnionId)) {
    return NextResponse.json({ error: "No access to this entry" }, { status: 403 });
  }
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const { id } = await params;
  const denied = await authorise(db, session, id);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ok = await updateWatchlistEntry(db, id, {
    companyName: typeof body.companyName === "string" ? body.companyName : undefined,
    type: typeof body.type === "string" ? body.type : undefined,
    expectedStage: typeof body.expectedStage === "string" ? body.expectedStage : undefined,
    expectedStartDate:
      typeof body.expectedStartDate === "number" ? body.expectedStartDate
      : body.expectedStartDate === null ? null : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    flaggedForOutreach: typeof body.flaggedForOutreach === "boolean" ? body.flaggedForOutreach : undefined,
    outreachNotes: typeof body.outreachNotes === "string" ? body.outreachNotes : undefined,
  });
  if (!ok) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const { id } = await params;
  const denied = await authorise(db, session, id);
  if (denied) return denied;

  const ok = await archiveWatchlistEntry(db, id);
  if (!ok) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
