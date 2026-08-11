import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { monitorScans } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { beginLikenessScan, failScan, runLikenessScan } from "@/lib/monitor/scan";
import { and, eq, gt } from "drizzle-orm";

// POST /api/monitor/scan — start a likeness sweep for the session talent.
//
// Real discovery runs Apify actors, which take 1-3 minutes — far longer than a
// request should be held open. So this opens the scan record, hands the work to
// waitUntil(), and returns the scan id for the client to poll at
// GET /api/monitor/scans/:id.
//
// Without a Cloudflare context (local dev) there is nothing to keep the worker
// alive, so the scan is awaited inline and returned complete in one shot. The
// client handles both by checking `status`.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can run likeness scans" }, { status: 403 });
  }

  const db = getDb();

  // One scan at a time per talent; a "running" row younger than 2 minutes
  // means another request is mid-flight (older ones are treated as stale).
  const inFlight = await db
    .select({ id: monitorScans.id })
    .from(monitorScans)
    .where(
      and(
        eq(monitorScans.talentId, session.sub),
        eq(monitorScans.status, "running"),
        gt(monitorScans.startedAt, Math.floor(Date.now() / 1000) - 120)
      )
    )
    .get();
  if (inFlight) {
    return NextResponse.json({ error: "A scan is already in progress" }, { status: 409 });
  }

  type ScanEnv = { AI?: Ai; ANTHROPIC_API_KEY?: string; APIFY_TOKEN?: string; YOUTUBE_API_KEY?: string };
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
    };
  }
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";

  const { scanId } = await beginLikenessScan(db, { talentId: session.sub, trigger: "manual" });

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
