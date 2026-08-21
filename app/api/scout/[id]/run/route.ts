import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { trialScans } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isScoutRole } from "@/lib/auth/roles";
import {
  failTrial,
  getTrialQuota,
  isTrialFeatureEnabled,
  runTrialScan,
  timeOutStaleTrials,
  type TrialSweepEnv,
} from "@/lib/monitor/trial";
import type { TrialSweepQueueMessage } from "@/lib/monitor/sweep-queue";
import { and, eq } from "drizzle-orm";

// POST /api/scout/:id/run — launch a trial sweep. This is the moment one of
// the account's trial runs is spent: the row flips draft → running before the
// message is enqueued, so the quota check and the spend are one transition.
// Delivery mirrors POST /api/monitor/scan — durable queue in production,
// waitUntil/inline fallback under `next dev`.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isScoutRole(session.role) && !isAdmin(session.email)) {
    return NextResponse.json({ error: "Trial sweeps are for rep and production accounts" }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();

  // Admin accounts bypass the feature toggle and the run quota — the owner
  // testing the product (including while it's switched off for everyone
  // else) is not a lead to meter. Spend still hits the global Apify ceiling.
  const admin = session.role === "admin" || isAdmin(session.email);
  if (!admin && !(await isTrialFeatureEnabled(db))) {
    return NextResponse.json({ error: "Trial sweeps are currently disabled" }, { status: 403 });
  }

  const trial = await db
    .select()
    .from(trialScans)
    .where(and(eq(trialScans.id, id), eq(trialScans.requestedBy, session.sub)))
    .get();
  if (!trial) return NextResponse.json({ error: "Trial not found" }, { status: 404 });
  if (trial.status !== "draft") {
    return NextResponse.json({ error: `Trial already ${trial.status}` }, { status: 409 });
  }

  // One sweep at a time per account — same single-flight rule as the monitor,
  // and the same reason: a second concurrent sweep doubles discovery spend.
  await timeOutStaleTrials(db, session.sub);
  const inFlight = await db
    .select({ id: trialScans.id })
    .from(trialScans)
    .where(and(eq(trialScans.requestedBy, session.sub), eq(trialScans.status, "running")))
    .get();
  if (inFlight) {
    return NextResponse.json(
      { error: "A trial sweep is already in progress", trialId: inFlight.id },
      { status: 409 }
    );
  }

  if (!admin) {
    const quota = await getTrialQuota(db, session.sub);
    if (quota.remaining <= 0) {
      return NextResponse.json(
        { error: "No trial runs remaining", quota },
        { status: 402 }
      );
    }
  }

  type RunEnv = TrialSweepEnv & { MONITOR_SWEEP_QUEUE?: Queue };
  let env: RunEnv = {};
  let waitUntil: ((p: Promise<unknown>) => void) | null = null;
  try {
    const ctx = getCloudflareContext();
    env = ctx.env as unknown as RunEnv;
    waitUntil = ctx.ctx?.waitUntil?.bind(ctx.ctx) ?? null;
  } catch {
    env = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      APIFY_TOKEN: process.env.APIFY_TOKEN,
      YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
      REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
      REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
      BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_REGION: process.env.AWS_REGION,
      CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
      R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
      R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    };
  }

  await db
    .update(trialScans)
    .set({ status: "running", startedAt: Math.floor(Date.now() / 1000), error: null })
    .where(eq(trialScans.id, id));

  if (env.MONITOR_SWEEP_QUEUE && process.env.NODE_ENV !== "development") {
    try {
      const message: TrialSweepQueueMessage = { type: "trial_sweep", trialId: id };
      await env.MONITOR_SWEEP_QUEUE.send(message);
      return NextResponse.json({ trialId: id, status: "running" }, { status: 202 });
    } catch (err) {
      console.warn(
        `[trial] sweep enqueue failed, falling back to request-path run: ${(err as Error).message}`
      );
    }
  }

  const work = async () => {
    try {
      await runTrialScan(env, db, { trialId: id });
    } catch (err) {
      await failTrial(db, id, err instanceof Error ? err.message : "Trial sweep failed");
    }
  };

  if (waitUntil) {
    waitUntil(work());
    return NextResponse.json({ trialId: id, status: "running" }, { status: 202 });
  }

  await work();
  return NextResponse.json({ trialId: id, status: "settled" });
}
