import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, inArray } from "drizzle-orm";

const KEYS = ["monitor_cron_enabled", "watchlist_reharvest_hours", "monitor_cron_last_run"];

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

// GET /api/admin/monitor/cron — current cron config + last-run timestamp.
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const db = getDb();
  const rows = await db
    .select({ key: aiSettings.key, value: aiSettings.value })
    .from(aiSettings)
    .where(inArray(aiSettings.key, KEYS))
    .all();

  const map = new Map(rows.map((r) => [r.key, r.value]));
  return NextResponse.json({
    enabled: (map.get("monitor_cron_enabled") ?? "true") === "true",
    watchlistReharvestHours: parseInt(map.get("watchlist_reharvest_hours") ?? "168", 10),
    lastRunAt: parseInt(map.get("monitor_cron_last_run") ?? "0", 10) || null,
  });
}

// PATCH /api/admin/monitor/cron — update toggle or reharvest hours.
export async function PATCH(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    watchlistReharvestHours?: number;
  };

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const updates: Array<{ key: string; value: string }> = [];

  if (typeof body.enabled === "boolean") {
    updates.push({ key: "monitor_cron_enabled", value: body.enabled ? "true" : "false" });
  }
  if (typeof body.watchlistReharvestHours === "number") {
    // Clamp to a sensible range. 1 hour is the practical floor (Apify rate
    // limits would bite anything shorter); 90 days is the ceiling.
    const clamped = Math.max(1, Math.min(24 * 90, Math.round(body.watchlistReharvestHours)));
    updates.push({ key: "watchlist_reharvest_hours", value: String(clamped) });
  }
  if (!updates.length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  for (const u of updates) {
    await db
      .insert(aiSettings)
      .values({ key: u.key, value: u.value, updatedAt: now })
      .onConflictDoUpdate({
        target: aiSettings.key,
        set: { value: u.value, updatedAt: now, updatedBy: g.session.sub },
      });
  }

  return NextResponse.json({ ok: true });
}

// POST /api/admin/monitor/cron — "Run now": call the sweeps endpoint with
// the shared secret so the operator doesn't have to wait for the next
// scheduled cron tick to verify the flow works.
export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const { env } = getCloudflareContext();
  const secret = (env as unknown as { CRON_SECRET?: string }).CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";
  const res = await fetch(`${baseUrl}/api/cron/monitor-sweeps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json({ status: res.status, body }, { status: res.ok ? 200 : 502 });
}
