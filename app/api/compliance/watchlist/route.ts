import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getUnionIdsForUser } from "@/lib/compliance/grants";
import { addWatchlistEntry, buildWatchlist } from "@/lib/compliance/watchlist";
import { getUnionPreset, UNION_PRESETS } from "@/lib/compliance/unions";

// GET  /api/compliance/watchlist?unionId= — active watchlist with live ratification status.
// POST /api/compliance/watchlist — add an entry to a union's list ({ unionId, ... }).
//
// Each union's list is its own. Union watchers (platform- or union-scoped) see
// only their union(s); admins see every list and may pick one via ?unionId=.

async function resolveUnion(
  db: ReturnType<typeof getDb>,
  session: { sub: string; email: string },
  requested: string | null,
): Promise<{ available: { id: string; shortName: string }[]; unionId: string } | { error: string; status: number }> {
  const available = isAdmin(session.email)
    ? UNION_PRESETS.map((u) => ({ id: u.id, shortName: u.shortName }))
    : (await getUnionIdsForUser(db, session.sub, { scopes: ["platform", "union"] })).map((id) => ({
        id,
        shortName: getUnionPreset(id)?.shortName ?? id,
      }));
  if (available.length === 0) return { error: "Forbidden", status: 403 };

  if (requested) {
    if (!available.some((a) => a.id === requested)) return { error: "No access to that union", status: 403 };
    return { available, unionId: requested };
  }
  // Default: first available union — mirrors the members roster picker so the
  // user always lands on one specific union's list rather than an aggregate.
  return { available, unionId: available[0].id };
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const ctx = await resolveUnion(db, session, new URL(req.url).searchParams.get("unionId"));
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const entries = await buildWatchlist(db, [ctx.unionId]);
  return NextResponse.json({ entries, unions: ctx.available, unionId: ctx.unionId });
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDb();
  const ctx = await resolveUnion(db, session, typeof body.unionId === "string" ? body.unionId : null);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

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
    unionId: ctx.unionId,
  });

  if (!id) return NextResponse.json({ error: "This production is already on the watchlist" }, { status: 409 });
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
