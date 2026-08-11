import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { monitorAccounts } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { normaliseHandle, parseHandleList } from "@/lib/monitor/ingest/follows";
import { and, desc, eq, inArray } from "drizzle-orm";

const PLATFORMS = ["instagram", "tiktok", "youtube", "x"];

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

// GET /api/admin/monitor/accounts — the full watchlist, admin-wide.
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const db = getDb();
  const accounts = await db
    .select()
    .from(monitorAccounts)
    .orderBy(desc(monitorAccounts.lastSeenAt))
    .limit(500)
    .all();

  return NextResponse.json({ accounts });
}

/**
 * POST /api/admin/monitor/accounts
 * Body: { platform, handles?: string[], text?: string, note?: string }
 *
 * Bulk-adds watchlist entries. Idempotent: handles already on file are counted
 * as skipped rather than duplicated, so the same paste can be run twice.
 */
export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const body = (await req.json().catch(() => ({}))) as {
    platform?: string;
    handles?: string[];
    text?: string;
    note?: string;
  };

  const platform = body.platform ?? "instagram";
  if (!PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  const fromText = body.text ? parseHandleList(body.text) : { handles: [], rejected: [] };
  const fromList = (body.handles ?? [])
    .map((h) => normaliseHandle(h))
    .filter((h): h is string => !!h);

  const handles = [...new Set([...fromText.handles, ...fromList])];
  if (!handles.length) {
    return NextResponse.json(
      { error: "No valid handles found", rejected: fromText.rejected },
      { status: 400 }
    );
  }
  if (handles.length > 500) {
    return NextResponse.json({ error: "Too many handles in one request (max 500)" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const existing = await db
    .select({ handle: monitorAccounts.handle })
    .from(monitorAccounts)
    .where(and(eq(monitorAccounts.platform, platform), inArray(monitorAccounts.handle, handles)))
    .all();
  const known = new Set(existing.map((e) => e.handle));

  const fresh = handles.filter((h) => !known.has(h));
  if (fresh.length) {
    await db.insert(monitorAccounts).values(
      fresh.map((handle) => ({
        id: crypto.randomUUID(),
        platform,
        handle,
        platformUserId: null,
        displayName: null,
        followerCount: null,
        firstSeenAt: now,
        lastSeenAt: now,
        // Curated entries start with no hits — they are accounts to watch, not
        // offenders. Talent-facing views only ever show accounts that have
        // actually hit them, so nothing here leaks into a talent's case files
        // until a sweep proves it should.
        hitCount: 0,
        cumulativeViews: 0,
        talentAffectedCount: 0,
        status: "watchlist" as const,
        notes: body.note?.slice(0, 500) ?? null,
      }))
    );
  }

  return NextResponse.json({
    added: fresh.length,
    skipped: handles.length - fresh.length,
    rejected: fromText.rejected,
    handles: fresh,
  });
}

// DELETE /api/admin/monitor/accounts?id=... — drop a curated entry.
export async function DELETE(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = getDb();
  const row = await db.select().from(monitorAccounts).where(eq(monitorAccounts.id, id)).get();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // An account with hits against it is evidence, not a list entry — clearing it
  // would orphan those hits. Mark it cleared instead.
  if (row.hitCount > 0) {
    await db.update(monitorAccounts).set({ status: "cleared" }).where(eq(monitorAccounts.id, id));
    return NextResponse.json({ ok: true, action: "cleared", reason: "Account has recorded hits" });
  }

  await db.delete(monitorAccounts).where(eq(monitorAccounts.id, id));
  return NextResponse.json({ ok: true, action: "deleted" });
}
