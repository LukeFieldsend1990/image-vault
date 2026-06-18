export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { canViewPlatformOversight } from "@/lib/compliance/grants";
import { addWatchlistEntry, buildWatchlist } from "@/lib/compliance/watchlist";

// GET  /api/compliance/watchlist — active watchlist with live ratification status.
// POST /api/compliance/watchlist — add an entry (TMDB-promoted or manual).
// Maintainers are admins + compliance watchers holding a platform-wide grant —
// exactly the set canViewPlatformOversight authorises.

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  if (!(await canViewPlatformOversight(db, session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const entries = await buildWatchlist(db);
  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  if (!(await canViewPlatformOversight(db, session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const id = await addWatchlistEntry(db, {
    name,
    companyName: typeof body.companyName === "string" ? body.companyName : null,
    tmdbId: typeof body.tmdbId === "number" ? body.tmdbId : null,
    type: typeof body.type === "string" ? body.type : null,
    expectedStage: typeof body.expectedStage === "string" ? body.expectedStage : null,
    expectedStartDate: typeof body.expectedStartDate === "number" ? body.expectedStartDate : null,
    source: body.source === "tmdb" ? "tmdb" : "manual",
    notes: typeof body.notes === "string" ? body.notes : null,
    addedBy: session.sub,
  });

  if (!id) return NextResponse.json({ error: "This production is already on the watchlist" }, { status: 409 });
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
