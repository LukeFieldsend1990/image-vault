/**
 * Dead-letter handling for ledger appends that could not be written.
 *
 * Why this exists, precisely:
 *
 * `appendEvent` assigns `seq` from the chain's current tip at write time. So an
 * append that never happened leaves **no trace at all** — the chain is one event
 * shorter than it should be, but every `prevHash` still matches, every hash still
 * recomputes, and `verifyChain` passes. There is no gap to find, because gaps are
 * only created by deleting a row that was written.
 *
 * That means no amount of after-the-fact checking can recover a dropped append.
 * The only moment the loss is knowable is the moment it fails. This module writes
 * that moment down, and makes it replayable.
 *
 * Replay appends the event at the current tip rather than trying to insert it at
 * its original position — an append-only chain cannot take an insertion, and
 * forcing one would break every hash after it. The replayed event therefore
 * carries its original `createdAt` in the payload so the record still shows when
 * the thing actually happened, while the chain order stays honest about when it
 * was written.
 */

import { and, desc, eq } from "drizzle-orm";
import { ledgerAppendFailures } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import { appendEvent, type AppendEventSpec } from "./ledger";

type Db = ReturnType<typeof getDb>;

/** Persist a failed append so it is visible and replayable. Never throws. */
export async function recordAppendFailure(
  db: Db,
  spec: AppendEventSpec,
  err: unknown,
  attempts = 1,
): Promise<void> {
  try {
    await db.insert(ledgerAppendFailures).values({
      id: crypto.randomUUID(),
      chainKey: spec.chainKey,
      eventType: String(spec.eventType),
      specJson: JSON.stringify(spec),
      errorMessage: err instanceof Error ? err.message : String(err),
      attempts,
      status: "unresolved",
      createdAt: Math.floor(Date.now() / 1000),
    });
  } catch {
    // The dead-letter write itself failed — the database is likely the problem
    // that caused the original failure. Console is the last resort, and on
    // Workers it reaches the tail log.
    console.error(
      `[ledger] append failed and could not be recorded: ${spec.chainKey} ${String(spec.eventType)}`,
      err,
    );
  }
}

export interface AppendFailure {
  id: string;
  chainKey: string;
  eventType: string;
  errorMessage: string | null;
  attempts: number;
  status: "unresolved" | "replayed" | "dismissed";
  replayedAt: number | null;
  replayedSeq: number | null;
  note: string | null;
  createdAt: number;
}

export async function listAppendFailures(
  db: Db,
  opts: { status?: "unresolved" | "replayed" | "dismissed"; limit?: number } = {},
): Promise<AppendFailure[]> {
  const rows = opts.status
    ? await db
        .select()
        .from(ledgerAppendFailures)
        .where(eq(ledgerAppendFailures.status, opts.status))
        .orderBy(desc(ledgerAppendFailures.createdAt))
        .limit(opts.limit ?? 100)
        .all()
    : await db
        .select()
        .from(ledgerAppendFailures)
        .orderBy(desc(ledgerAppendFailures.createdAt))
        .limit(opts.limit ?? 100)
        .all();

  return rows.map((r) => ({
    id: r.id,
    chainKey: r.chainKey,
    eventType: r.eventType,
    errorMessage: r.errorMessage,
    attempts: r.attempts,
    status: r.status as AppendFailure["status"],
    replayedAt: r.replayedAt,
    replayedSeq: r.replayedSeq,
    note: r.note,
    createdAt: r.createdAt,
  }));
}

export type ReplayResult =
  | { ok: true; seq: number; hash: string }
  | { ok: false; error: string };

/**
 * Replay a failed append onto the current tip of its chain.
 *
 * The event lands at the end, not at the position it would have had. The
 * original failure time is carried into the payload as `replayedFromFailedAt`
 * so the record does not silently claim the event happened when it was replayed.
 */
export async function replayAppendFailure(
  db: Db,
  failureId: string,
  actorId: string,
): Promise<ReplayResult> {
  const row = await db
    .select()
    .from(ledgerAppendFailures)
    .where(and(eq(ledgerAppendFailures.id, failureId), eq(ledgerAppendFailures.status, "unresolved")))
    .get();
  if (!row) return { ok: false, error: "No unresolved failure with that id" };

  let spec: AppendEventSpec;
  try {
    spec = JSON.parse(row.specJson) as AppendEventSpec;
  } catch {
    return { ok: false, error: "Stored spec is not readable — cannot replay" };
  }

  const payload: Record<string, unknown> =
    spec.payload && typeof spec.payload === "object" && !Array.isArray(spec.payload)
      ? { ...(spec.payload as Record<string, unknown>) }
      : { original: spec.payload ?? {} };
  payload.replayedFromFailedAt = row.createdAt;

  try {
    const appended = await appendEvent(db, { ...spec, payload });
    await db
      .update(ledgerAppendFailures)
      .set({
        status: "replayed",
        replayedAt: Math.floor(Date.now() / 1000),
        replayedSeq: appended.seq,
        resolvedBy: actorId,
      })
      .where(eq(ledgerAppendFailures.id, failureId));
    return { ok: true, seq: appended.seq, hash: appended.hash };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(ledgerAppendFailures)
      .set({ attempts: row.attempts + 1, errorMessage: message })
      .where(eq(ledgerAppendFailures.id, failureId));
    return { ok: false, error: message };
  }
}

/** Close a failure without replaying it — e.g. the event was written another way. */
export async function dismissAppendFailure(
  db: Db,
  failureId: string,
  actorId: string,
  note: string,
): Promise<boolean> {
  const row = await db
    .select({ id: ledgerAppendFailures.id })
    .from(ledgerAppendFailures)
    .where(and(eq(ledgerAppendFailures.id, failureId), eq(ledgerAppendFailures.status, "unresolved")))
    .get();
  if (!row) return false;

  await db
    .update(ledgerAppendFailures)
    .set({ status: "dismissed", resolvedBy: actorId, note, replayedAt: Math.floor(Date.now() / 1000) })
    .where(eq(ledgerAppendFailures.id, failureId));
  return true;
}
