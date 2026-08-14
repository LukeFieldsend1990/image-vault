import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { likenessMonitors, aiSettings, users } from "@/lib/db/schema";
import { beginLikenessScan, failScan, runLikenessScan } from "@/lib/monitor/scan";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

/**
 * POST /api/cron/monitor-sweeps — the scheduled entrypoint the ai-cron-worker
 * hits to run due monitors. Auth is a shared secret in the Authorization
 * header, not a talent session — this is a machine-to-machine boundary.
 *
 * The endpoint is intentionally idempotent-ish rather than strictly so: two
 * concurrent invocations both find the same monitors due, but the in-flight
 * guard in beginLikenessScan / the scan endpoint prevents duplicate work
 * per talent. Two cron workers firing 30 seconds apart is fine.
 *
 * Cadence semantics:
 *   - manual → never run by cron (still runs on user click)
 *   - daily  → due when now - last_scan_at >= 86400
 *   - weekly → due when now - last_scan_at >= 604800
 *   - null last_scan_at (never scanned) → due immediately
 */

const CADENCE_SECONDS: Record<string, number> = {
  daily: 86_400,
  weekly: 604_800,
};

export async function POST(req: NextRequest) {
  const { env } = getCloudflareContext();
  const secret = (env as unknown as { CRON_SECRET?: string }).CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.replace(/^Bearer\s+/i, "");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Global kill switch. Flipped from /admin/monitor; also lets us pause the
  // fleet during platform incidents without redeploying the cron worker.
  const enabledRow = await db
    .select({ value: aiSettings.value })
    .from(aiSettings)
    .where(eq(aiSettings.key, "monitor_cron_enabled"))
    .get();
  if (enabledRow?.value !== "true") {
    return NextResponse.json({ ok: true, skipped: "cron_disabled" });
  }

  // Due list: active monitors with a cadence, where either the last scan
  // is old enough or there's been no scan yet. Suspended talents are
  // filtered by the users join.
  const due = await db
    .select({
      talentId: likenessMonitors.talentId,
      cadence: likenessMonitors.cadence,
      lastScanAt: likenessMonitors.lastScanAt,
    })
    .from(likenessMonitors)
    .innerJoin(users, eq(users.id, likenessMonitors.talentId))
    .where(
      and(
        eq(likenessMonitors.status, "active"),
        inArray(likenessMonitors.cadence, ["daily", "weekly"]),
        isNull(users.suspendedAt)
      )
    )
    .all();

  const shouldRun = due.filter((m) => {
    const window = CADENCE_SECONDS[m.cadence] ?? Infinity;
    return !m.lastScanAt || now - m.lastScanAt >= window;
  });

  // Stamp the run marker up front so admin UIs (and the next cron tick)
  // can tell the sweep started even if it errors halfway.
  await db
    .insert(aiSettings)
    .values({ key: "monitor_cron_last_run", value: String(now), updatedAt: now })
    .onConflictDoUpdate({
      target: aiSettings.key,
      set: { value: String(now), updatedAt: now },
    });

  if (!shouldRun.length) {
    return NextResponse.json({ ok: true, dueCount: 0, ran: 0 });
  }

  // waitUntil keeps the worker alive while the scans finish (~5 min each).
  // The response returns immediately so cron doesn't hold the connection.
  const waitUntil = (getCloudflareContext().ctx?.waitUntil?.bind(getCloudflareContext().ctx)) as
    | ((p: Promise<unknown>) => void)
    | undefined;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";
  const scanEnv = {
    AI: (env as unknown as { AI?: Ai }).AI,
    ANTHROPIC_API_KEY: (env as unknown as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY,
    APIFY_TOKEN: (env as unknown as { APIFY_TOKEN?: string }).APIFY_TOKEN,
    YOUTUBE_API_KEY: (env as unknown as { YOUTUBE_API_KEY?: string }).YOUTUBE_API_KEY,
    AWS_ACCESS_KEY_ID: (env as unknown as { AWS_ACCESS_KEY_ID?: string }).AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: (env as unknown as { AWS_SECRET_ACCESS_KEY?: string }).AWS_SECRET_ACCESS_KEY,
    AWS_REGION: (env as unknown as { AWS_REGION?: string }).AWS_REGION,
  };

  const kickoff = async () => {
    for (const monitor of shouldRun) {
      // Serial rather than parallel: each scan chews Apify budget, and one
      // talent's sweep at a time is fine when cron runs twice daily. Parallel
      // would risk multiple sweeps racing the same budget ceiling check.
      try {
        const { scanId } = await beginLikenessScan(db, {
          talentId: monitor.talentId,
          trigger: "scheduled",
        });
        await runLikenessScan(scanEnv, db, {
          talentId: monitor.talentId,
          trigger: "scheduled",
          baseUrl,
          scanId,
        });
      } catch (err) {
        console.warn(
          `[cron] monitor sweep for ${monitor.talentId} failed: ${(err as Error).message}`
        );
      }
    }
  };

  if (waitUntil) {
    waitUntil(kickoff());
  } else {
    // Non-Cloudflare context (local dev without waitUntil binding): run
    // inline. Response takes minutes, which is fine because there's no
    // real cron scheduler here to worry about.
    await kickoff();
  }

  return NextResponse.json({ ok: true, dueCount: shouldRun.length, ran: shouldRun.length });
}
