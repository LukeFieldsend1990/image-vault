import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { likenessMonitors, monitorScans, aiSettings, users } from "@/lib/db/schema";
import { beginLikenessScan, failScan, runLikenessScan, timeOutStaleScans } from "@/lib/monitor/scan";
import type { SweepQueueMessage } from "@/lib/monitor/sweep-queue";
import { talentsUnderVigilance } from "@/lib/monitor/events";
import { surgeIntervalSeconds } from "@/lib/monitor/vigilance";
import { and, eq, inArray, isNull } from "drizzle-orm";

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
 *   - any of the above, while an announcement window is open for that talent →
 *     due on the surge interval instead (12h at peak, 24h after), except
 *     `manual`, which is never auto-run whatever is happening in the news.
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

  // Talent inside an open announcement window sweep on a surge interval instead
  // of their stored cadence. A weekly monitor is the wrong cadence for the week
  // the content is being made: by the time the next weekly sweep runs, a
  // peak-phase reel has had six days of unopposed reach. The window is bounded
  // and decays (lib/monitor/vigilance.ts), so this is a temporary lift, not a
  // permanent cadence change — and `manual` is still never auto-run.
  let underVigilance = new Map<string, "peak" | "elevated">();
  try {
    underVigilance = await talentsUnderVigilance(db, now);
  } catch (err) {
    console.warn(`[cron] vigilance lookup failed: ${(err as Error).message}`);
  }

  const shouldRun = due.filter((m) => {
    const cadenceWindow = CADENCE_SECONDS[m.cadence] ?? Infinity;
    const phase = underVigilance.get(m.talentId);
    const window = phase ? Math.min(cadenceWindow, surgeIntervalSeconds(phase)) : cadenceWindow;
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

  // In-flight guard: a queued sweep can wait its turn behind others (the
  // consumer runs one sweep at a time), so a talent's previous sweep may
  // still be pending or mid-run when the next cron tick fires. Settle dead
  // runs first so a stranded row doesn't block its talent forever, then skip
  // any talent with a live scan rather than double-enqueueing identical work.
  await timeOutStaleScans(db);
  const running = await db
    .select({ talentId: monitorScans.talentId })
    .from(monitorScans)
    .where(eq(monitorScans.status, "running"))
    .all();
  const inFlight = new Set(running.map((r) => r.talentId));

  // waitUntil keeps the worker alive if any sweep has to run on the request
  // path (queue unavailable). The response returns immediately either way.
  const waitUntil = (getCloudflareContext().ctx?.waitUntil?.bind(getCloudflareContext().ctx)) as
    | ((p: Promise<unknown>) => void)
    | undefined;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";
  const scanEnv = {
    AI: (env as unknown as { AI?: Ai }).AI,
    // Scheduled sweeps capture hit previews into R2 too — otherwise the
    // overnight hits are the ones with dead thumbnails by morning.
    SCANS_BUCKET: (env as unknown as { SCANS_BUCKET?: R2Bucket }).SCANS_BUCKET,
    ANTHROPIC_API_KEY: (env as unknown as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY,
    APIFY_TOKEN: (env as unknown as { APIFY_TOKEN?: string }).APIFY_TOKEN,
    YOUTUBE_API_KEY: (env as unknown as { YOUTUBE_API_KEY?: string }).YOUTUBE_API_KEY,
    REDDIT_CLIENT_ID: (env as unknown as { REDDIT_CLIENT_ID?: string }).REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET: (env as unknown as { REDDIT_CLIENT_SECRET?: string }).REDDIT_CLIENT_SECRET,
    BRAVE_SEARCH_API_KEY: (env as unknown as { BRAVE_SEARCH_API_KEY?: string }).BRAVE_SEARCH_API_KEY,
    AWS_ACCESS_KEY_ID: (env as unknown as { AWS_ACCESS_KEY_ID?: string }).AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: (env as unknown as { AWS_SECRET_ACCESS_KEY?: string }).AWS_SECRET_ACCESS_KEY,
    AWS_REGION: (env as unknown as { AWS_REGION?: string }).AWS_REGION,
    // R2 signing so scheduled sweeps match against vault reference images too.
    CF_ACCOUNT_ID: (env as unknown as { CF_ACCOUNT_ID?: string }).CF_ACCOUNT_ID,
    R2_BUCKET_NAME: (env as unknown as { R2_BUCKET_NAME?: string }).R2_BUCKET_NAME,
    R2_ACCESS_KEY_ID: (env as unknown as { R2_ACCESS_KEY_ID?: string }).R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: (env as unknown as { R2_SECRET_ACCESS_KEY?: string }).R2_SECRET_ACCESS_KEY,
  };

  // Durable path: open the scan row, hand the sweep to the monitor-sweeps
  // queue (consumed by this same Worker — see worker.ts), move on. The queue
  // serialises sweeps globally, which preserves the old serial-kickoff
  // property that mattered: one sweep at a time against the shared Apify
  // budget ceiling. NODE_ENV guard as in POST /api/monitor/scan — `next dev`
  // has a producer binding with no consumer behind it.
  const queue = (env as unknown as { MONITOR_SWEEP_QUEUE?: Queue }).MONITOR_SWEEP_QUEUE;
  const useQueue = !!queue && process.env.NODE_ENV !== "development";

  let queued = 0;
  let skippedInFlight = 0;
  const inlineRuns: { talentId: string; scanId?: string }[] = [];

  for (const monitor of shouldRun) {
    if (inFlight.has(monitor.talentId)) {
      skippedInFlight++;
      continue;
    }
    if (!useQueue) {
      inlineRuns.push({ talentId: monitor.talentId });
      continue;
    }
    try {
      const { scanId } = await beginLikenessScan(db, {
        talentId: monitor.talentId,
        trigger: "scheduled",
      });
      try {
        const message: SweepQueueMessage = {
          type: "likeness_sweep",
          scanId,
          talentId: monitor.talentId,
          trigger: "scheduled",
        };
        await queue!.send(message);
        queued++;
      } catch (err) {
        // Row is already open and the client-visible contract is that it will
        // settle — fall back to the request-path run with the same scanId.
        console.warn(
          `[cron] sweep enqueue for ${monitor.talentId} failed, running on request path: ${(err as Error).message}`
        );
        inlineRuns.push({ talentId: monitor.talentId, scanId });
      }
    } catch (err) {
      console.warn(`[cron] could not open scan for ${monitor.talentId}: ${(err as Error).message}`);
    }
  }

  const kickoff = async () => {
    for (const run of inlineRuns) {
      // Serial rather than parallel: each scan chews Apify budget, and one
      // talent's sweep at a time is fine when cron runs twice daily. Parallel
      // would risk multiple sweeps racing the same budget ceiling check.
      let scanId = run.scanId;
      try {
        scanId ??= (
          await beginLikenessScan(db, { talentId: run.talentId, trigger: "scheduled" })
        ).scanId;
        await runLikenessScan(scanEnv, db, {
          talentId: run.talentId,
          trigger: "scheduled",
          baseUrl,
          scanId,
        });
      } catch (err) {
        console.warn(
          `[cron] monitor sweep for ${run.talentId} failed: ${(err as Error).message}`
        );
        if (scanId) {
          await failScan(db, scanId, err instanceof Error ? err.message : "Scan failed").catch(
            () => {}
          );
        }
      }
    }
  };

  if (inlineRuns.length) {
    if (waitUntil) {
      waitUntil(kickoff());
    } else {
      // Non-Cloudflare context (local dev without waitUntil binding): run
      // inline. Response takes minutes, which is fine because there's no
      // real cron scheduler here to worry about.
      await kickoff();
    }
  }

  return NextResponse.json({
    ok: true,
    dueCount: shouldRun.length,
    ran: queued + inlineRuns.length,
    queued,
    skippedInFlight,
    surged: shouldRun.filter((m) => underVigilance.has(m.talentId)).length,
  });
}
