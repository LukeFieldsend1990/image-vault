import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { monitorScans } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { beginLikenessScan, failScan, runLikenessScan, timeOutStaleScans } from "@/lib/monitor/scan";
import type { SweepQueueMessage } from "@/lib/monitor/sweep-queue";
import { and, eq } from "drizzle-orm";

// POST /api/monitor/scan — start a likeness sweep for the session talent.
//
// Real discovery runs Apify actors, which take 1-3 minutes each — far longer
// than a request should be held open. This opens the scan record, enqueues the
// sweep onto the monitor-sweeps queue (consumed by this same Worker via the
// worker.ts entrypoint), and returns the scan id for the client to poll at
// GET /api/monitor/scans/:id. Queue delivery survives isolate eviction — the
// failure mode that used to strand waitUntil()-backed sweeps as "running"
// until the 15-minute lazy timeout.
//
// Local dev (`next dev`) keeps the old path: the dev binding proxy has no
// queue consumer attached, so the sweep is awaited inline and returned
// complete in one shot. The client handles both by checking `status`.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can run likeness scans" }, { status: 403 });
  }

  const db = getDb();

  // One scan at a time per talent. Dead runs are settled first (marked as
  // errors past the 15-minute timeout), so any row still "running" here really
  // is mid-flight — a sweep chains several 1-3 minute Apify runs, and a second
  // concurrent sweep would double the Apify spend for identical results.
  await timeOutStaleScans(db, session.sub);
  const inFlight = await db
    .select({ id: monitorScans.id })
    .from(monitorScans)
    .where(and(eq(monitorScans.talentId, session.sub), eq(monitorScans.status, "running")))
    .get();
  if (inFlight) {
    return NextResponse.json(
      { error: "A scan is already in progress", scanId: inFlight.id },
      { status: 409 }
    );
  }

  type ScanEnv = {
    AI?: Ai;
    ANTHROPIC_API_KEY?: string;
    APIFY_TOKEN?: string;
    YOUTUBE_API_KEY?: string;
    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
    AWS_REGION?: string;
    // R2 signing so the sweep can use vault scan stills as face-match references.
    CF_ACCOUNT_ID?: string;
    R2_BUCKET_NAME?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;
    MONITOR_SWEEP_QUEUE?: Queue;
  };
  let env: ScanEnv = {};
  let waitUntil: ((p: Promise<unknown>) => void) | null = null;
  try {
    const ctx = getCloudflareContext();
    env = ctx.env as unknown as ScanEnv;
    waitUntil = ctx.ctx?.waitUntil?.bind(ctx.ctx) ?? null;
  } catch {
    env = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      APIFY_TOKEN: process.env.APIFY_TOKEN,
      YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_REGION: process.env.AWS_REGION,
      CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
      R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
      R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    };
  }
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";

  const { scanId } = await beginLikenessScan(db, { talentId: session.sub, trigger: "manual" });

  // Durable path. NODE_ENV guard: under `next dev` the binding proxy exposes a
  // queue producer with no consumer behind it — a send there would strand the
  // scan until the lazy timeout. A send failure (e.g. queue not yet created)
  // falls back to the request-path run rather than stranding the row.
  if (env.MONITOR_SWEEP_QUEUE && process.env.NODE_ENV !== "development") {
    try {
      const message: SweepQueueMessage = {
        type: "likeness_sweep",
        scanId,
        talentId: session.sub,
        trigger: "manual",
      };
      await env.MONITOR_SWEEP_QUEUE.send(message);
      return NextResponse.json({ scanId, status: "running" }, { status: 202 });
    } catch (err) {
      console.warn(
        `[monitor] sweep enqueue failed, falling back to request-path run: ${(err as Error).message}`
      );
    }
  }

  const work = async () => {
    try {
      await runLikenessScan(env, db, {
        talentId: session.sub,
        trigger: "manual",
        baseUrl,
        scanId,
      });
    } catch (err) {
      // Nothing is awaiting this, so an unrecorded failure would leave the scan
      // "running" forever and the talent watching a spinner.
      await failScan(db, scanId, err instanceof Error ? err.message : "Scan failed");
    }
  };

  if (waitUntil) {
    waitUntil(work());
    return NextResponse.json({ scanId, status: "running" }, { status: 202 });
  }

  await work();
  return NextResponse.json({ scanId, status: "settled" });
}
