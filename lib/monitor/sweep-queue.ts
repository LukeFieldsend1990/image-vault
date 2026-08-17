/**
 * Durable sweep execution over the `monitor-sweeps` queue.
 *
 * A sweep chains several 1-3 minute Apify actor runs — far longer than a
 * request-path isolate is guaranteed to live. Production evidence (scan
 * aa8be413-9e43-42c0-a629-41875dc55dbc, 2026-08-17): the app Worker isolate
 * can be evicted or OOM-killed a minute into a waitUntil()-backed sweep,
 * after the first Apify run, leaving the scan row "running" with no error
 * until the 15-minute lazy timeout settles it. Queue delivery survives
 * isolate death: the message redelivers and the consumer either finishes the
 * job or records an honest failure on the row.
 *
 * Producers (POST /api/monitor/scan and POST /api/cron/monitor-sweeps) call
 * beginLikenessScan() first so the client has a row to poll, then enqueue a
 * SweepQueueMessage and return. The consumer lives in worker.ts — the custom
 * OpenNext entrypoint — and calls runQueuedSweep() for each delivery. The
 * polling contract (GET /api/monitor/scans/:id) is unchanged.
 *
 * Retry semantics: a redelivered message means the previous consumer died
 * without recording anything. Re-running discovery would double the Apify
 * spend for identical results, so a redelivery only re-runs when the dead
 * attempt provably never reached paid discovery (no apify_usage rows for the
 * scan); otherwise the scan is settled as an error and the talent can start
 * a fresh sweep. Errors the consumer survives are recorded via failScan()
 * and never retried — runLikenessScan may have spent money before throwing.
 */

import { eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { apifyUsage, monitorScans } from "@/lib/db/schema";
import { failScan, runLikenessScan } from "./scan";

type Db = ReturnType<typeof getDb>;

/** The env surface runLikenessScan needs — bindings plus monitor secrets. */
export type SweepEnv = Parameters<typeof runLikenessScan>[0];

export interface SweepQueueMessage {
  type: "likeness_sweep";
  /** Row already opened by beginLikenessScan() — the client is polling it. */
  scanId: string;
  talentId: string;
  trigger: "manual" | "scheduled";
}

export type SweepDeliveryDecision =
  | { action: "run" }
  /** Nothing to do — ack quietly (row settled, or already timed out). */
  | { action: "skip"; reason: string }
  /** Settle the row as an error without re-running discovery. */
  | { action: "fail"; reason: string };

/**
 * Decide what a delivery should do, given what the scan row and the Apify
 * ledger say about previous attempts. Pure so the retry semantics are
 * unit-testable without a queue or a database.
 */
export function decideSweepDelivery(input: {
  /** Current monitor_scans.status, or null when the row is missing. */
  scanStatus: string | null;
  /** Queue delivery attempt, 1-based (message.attempts). */
  attempts: number;
  /** Whether any apify_usage row exists for this scanId. */
  hasApifySpend: boolean;
}): SweepDeliveryDecision {
  if (input.scanStatus === null) {
    return { action: "skip", reason: "scan row not found" };
  }
  if (input.scanStatus !== "running") {
    // failScan, completion, or the lazy timeout already settled it.
    return { action: "skip", reason: `scan already ${input.scanStatus}` };
  }
  if (input.attempts > 1 && input.hasApifySpend) {
    return {
      action: "fail",
      reason:
        "The sweep worker died mid-run after paid discovery had started. " +
        "Not re-run automatically — start a new sweep to try again.",
    };
  }
  return { action: "run" };
}

/**
 * Consume one sweep delivery. Never throws: every failure path is recorded
 * on the scan row (or deliberately skipped), so the caller always acks —
 * redelivery is reserved for consumers that die without reaching a catch.
 */
export async function runQueuedSweep(
  env: SweepEnv,
  db: Db,
  message: SweepQueueMessage,
  attempts: number,
  baseUrl?: string
): Promise<void> {
  const scan = await db
    .select({ status: monitorScans.status })
    .from(monitorScans)
    .where(eq(monitorScans.id, message.scanId))
    .get();

  // Only consult the spend ledger when this is a redelivery — on a first
  // delivery the row was opened moments ago and cannot have spent anything.
  let hasApifySpend = false;
  if (attempts > 1) {
    const spend = await db
      .select({ id: apifyUsage.id })
      .from(apifyUsage)
      .where(eq(apifyUsage.scanId, message.scanId))
      .limit(1)
      .get();
    hasApifySpend = !!spend;
  }

  const decision = decideSweepDelivery({
    scanStatus: scan?.status ?? null,
    attempts,
    hasApifySpend,
  });

  if (decision.action === "skip") {
    console.log(`[monitor] sweep ${message.scanId} delivery skipped: ${decision.reason}`);
    return;
  }
  if (decision.action === "fail") {
    console.warn(`[monitor] sweep ${message.scanId} settled without re-run: ${decision.reason}`);
    await failScan(db, message.scanId, decision.reason);
    return;
  }

  try {
    await runLikenessScan(env, db, {
      talentId: message.talentId,
      trigger: message.trigger,
      baseUrl,
      scanId: message.scanId,
    });
  } catch (err) {
    // Recorded rather than retried: runLikenessScan may have spent Apify
    // budget before throwing, and discovery errors it detects itself are
    // already written to the row before the throw.
    await failScan(db, message.scanId, err instanceof Error ? err.message : "Scan failed");
  }
}
