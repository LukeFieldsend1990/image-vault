// Business reason (39.J) + AI-training-data notice (39.L) — SPEC §16.7 / §16.3.
// Both are pure ledger events on the licence chain (no projection table needed).

import { appendEvent, licenceChain } from "./ledger";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export async function recordBusinessReason(
  db: Db,
  p: { licenceId: string; organisationId?: string | null; actorId: string; reason: string; ip?: string | null; ua?: string | null },
) {
  return appendEvent(db, {
    chainKey: licenceChain(p.licenceId),
    eventType: "business_reason.recorded",
    clauseRef: "39.J",
    licenceId: p.licenceId,
    organisationId: p.organisationId ?? null,
    actorId: p.actorId,
    payload: { reason: p.reason },
    ipAddress: p.ip ?? null,
    userAgent: p.ua ?? null,
  });
}

export async function fileTrainingNotice(
  db: Db,
  p: { licenceId: string; organisationId?: string | null; actorId: string; detail?: unknown; ip?: string | null; ua?: string | null },
) {
  return appendEvent(db, {
    chainKey: licenceChain(p.licenceId),
    eventType: "training.notice_filed",
    clauseRef: "39.L",
    licenceId: p.licenceId,
    organisationId: p.organisationId ?? null,
    actorId: p.actorId,
    payload: { detail: p.detail ?? {} },
    ipAddress: p.ip ?? null,
    userAgent: p.ua ?? null,
  });
}
