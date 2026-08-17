/**
 * Probe evidence, written into the compliance ledger.
 *
 * The general ledger (lib/compliance/ledger.ts) hashes only
 * {chainKey, seq, eventType, payload} — `createdAt`, `actorId`, `ipAddress` and
 * the rest are stored alongside each row but are NOT covered by the hash, by
 * design (so org backfill can't break verification). For most events that is
 * fine: the *fact* is what matters, not the exact second.
 *
 * A probe report is different. Its entire claim turns on *when* the model was
 * interrogated and *what file* was tested — a dispute over "the model post-dates
 * the scans" lives or dies on that timestamp. So this helper folds the moment,
 * the actor, and the artifact's SHA-256 INTO the payload before appending, which
 * puts them under the hash. verifyChain() then protects them like any other
 * payload field, and the sealed report can cite the payload `at` field as the
 * tamper-evident time — never the mutable DB `createdAt` column.
 */

import type { getDb } from "@/lib/db";
import { appendEvent, talentChain } from "@/lib/compliance/ledger";
import { isoUtc } from "@/lib/documents/palette";

type Db = ReturnType<typeof getDb>;

export type ProbeEventType =
  | "probe.run_started"
  | "probe.run_completed"
  | "probe.report_sealed";

export interface AppendProbeEventInput {
  db: Db;
  talentId: string;
  runId: string;
  eventType: ProbeEventType;
  /** Unix seconds. Stamped into the hashed payload as an ISO-UTC string. */
  at: number;
  actorId?: string | null;
  /** The probed artifact's SHA-256, where known — pins which file was tested. */
  targetSha256?: string | null;
  /** The run manifest's SHA-256 on completion — pins the exact evidence set. */
  manifestSha256?: string | null;
  /** Anything else worth sealing (verdict summary, target ref, seal ref). */
  detail?: Record<string, unknown>;
}

/**
 * Append one probe event to the talent's compliance chain with time, actor and
 * artifact hashes inside the hashed payload. Returns the appended event.
 */
export async function appendProbeEvent(input: AppendProbeEventInput) {
  const payload = {
    // These three are the point of this helper: hash-covered evidence fields.
    at: isoUtc(input.at),
    atUnix: input.at,
    actorId: input.actorId ?? null,
    runId: input.runId,
    targetSha256: input.targetSha256 ?? null,
    manifestSha256: input.manifestSha256 ?? null,
    ...(input.detail ?? {}),
  };

  return appendEvent(input.db, {
    chainKey: talentChain(input.talentId),
    eventType: input.eventType,
    talentId: input.talentId,
    actorId: input.actorId ?? null,
    // clauseRef ties probe evidence to the training obligation the platform
    // already models (SAG-AFTRA §39.G / 39.L family) without asserting a breach.
    clauseRef: "39.G",
    payload,
  });
}
