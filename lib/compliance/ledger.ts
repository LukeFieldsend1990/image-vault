// Append-only, hash-chained compliance ledger (SPEC §16.5).
//
// Each chain (keyed by `licence:{id}` or `talent:{id}`) seals every event into
// the next: hash = SHA-256(prevHash + canonicalJson(content)). The genesis
// event's prevHash is the chain_key itself. Any retroactive edit or deletion
// breaks verifyChain(), and the certificate (§16.12) embeds the tip hash as a
// tamper seal.

import { desc, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { complianceEvents, licences } from "@/lib/db/schema";
import type {
  ChainVerification,
  ComplianceEventType,
  ComplianceScope,
  HashedEvent,
  LedgerEventInput,
  RegimeId,
} from "./types";

type Db = ReturnType<typeof getDb>;

// ── Pure crypto + canonicalisation ──────────────────────────────────────────

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Deterministic JSON: object keys sorted recursively so logically-equal payloads
// always hash identically regardless of key insertion order.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// Compute the hash for a single event given the previous tip hash. Pure.
export async function hashEvent(input: LedgerEventInput, prevHash: string): Promise<HashedEvent> {
  const content = canonicalJson({
    chainKey: input.chainKey,
    seq: input.seq,
    eventType: input.eventType,
    payload: input.payload ?? {},
  });
  const hash = await sha256Hex(`${prevHash}${content}`);
  return { ...input, prevHash, hash };
}

// Where the next event in a chain sits, given the current tip (or null = empty).
// Genesis: seq 0, prevHash = chainKey. Pure — DB-free, unit-testable.
export function computeNext(
  chainKey: string,
  tip: { seq: number; hash: string } | null,
): { seq: number; prevHash: string } {
  if (!tip) return { seq: 0, prevHash: chainKey };
  return { seq: tip.seq + 1, prevHash: tip.hash };
}

// Verify a full chain (must start at genesis / seq 0). Returns the first break.
export async function verifyChain(chain: HashedEvent[]): Promise<ChainVerification> {
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    if (e.seq !== i) {
      return { ok: false, brokenAtSeq: e.seq, reason: `seq discontinuity: expected ${i}, got ${e.seq}` };
    }
    const expectedPrev = i === 0 ? e.chainKey : chain[i - 1].hash;
    if (e.prevHash !== expectedPrev) {
      return { ok: false, brokenAtSeq: e.seq, reason: "prev_hash does not match previous event" };
    }
    const recomputed = await hashEvent(
      { chainKey: e.chainKey, seq: e.seq, eventType: e.eventType, payload: e.payload },
      expectedPrev,
    );
    if (recomputed.hash !== e.hash) {
      return { ok: false, brokenAtSeq: e.seq, reason: "hash mismatch — event content was altered" };
    }
  }
  return { ok: true };
}

// ── DB-touching append ──────────────────────────────────────────────────────

export interface AppendEventSpec {
  chainKey: string;
  eventType: ComplianceEventType | string;
  regime?: RegimeId;
  clauseRef?: string | null;
  licenceId?: string | null;
  talentId?: string | null;
  organisationId?: string | null;
  actorId?: string | null;
  scope?: ComplianceScope;
  payload?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AppendedEvent {
  id: string;
  chainKey: string;
  seq: number;
  hash: string;
  prevHash: string;
  createdAt: number;
}

/** How many times a losing racer re-reads the tip before giving up. */
const APPEND_MAX_ATTEMPTS = 5;

/**
 * Whether a thrown error is the unique index on (chain_key, seq) rejecting a
 * racing append. Matched on message because D1 surfaces SQLite's error text
 * rather than a typed error; deliberately narrow, so anything else propagates.
 */
function isSeqCollision(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT|constraint failed: compliance_events/i.test(msg);
}

// Append a new event to a chain. Reads the tip, computes seq + prev_hash, hashes
// the canonical content, and inserts. The unique index on (chain_key, seq)
// serialises concurrent appends — a racing duplicate seq throws, and the loser
// re-reads the tip and retries here. Events are human-paced
// (consent/strike/transfer), so contention is rare and a handful of attempts is
// ample.
//
// The retry lives here rather than in each caller because the losing racer must
// recompute `prevHash` from the *new* tip: retrying with the original values
// would chain off an event that is no longer the tip and produce a chain that
// fails verification. That is not something call sites should have to know.
export async function appendEvent(db: Db, spec: AppendEventSpec): Promise<AppendedEvent> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < APPEND_MAX_ATTEMPTS; attempt++) {
    try {
      return await appendEventOnce(db, spec);
    } catch (err) {
      if (!isSeqCollision(err)) throw err;
      lastErr = err;
      // Brief, growing pause so simultaneous racers separate rather than
      // colliding again on the same re-read.
      await new Promise((r) => setTimeout(r, 8 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`ledger append failed after ${APPEND_MAX_ATTEMPTS} attempts on ${spec.chainKey}`);
}

async function appendEventOnce(db: Db, spec: AppendEventSpec): Promise<AppendedEvent> {
  const tip = await db
    .select({ seq: complianceEvents.seq, hash: complianceEvents.hash })
    .from(complianceEvents)
    .where(eq(complianceEvents.chainKey, spec.chainKey))
    .orderBy(desc(complianceEvents.seq))
    .limit(1)
    .get();

  const { seq, prevHash } = computeNext(spec.chainKey, tip ?? null);
  const payload = spec.payload ?? {};
  const { hash } = await hashEvent(
    { chainKey: spec.chainKey, seq, eventType: spec.eventType, payload },
    prevHash,
  );

  // Carry org context on every licence-chain event. Cast/production licences and
  // their callers historically left this null even when the licence belongs to an
  // org — backfill it from the licence so org-scoped event queries and org-sealed
  // certificates see the event. organisationId is not part of the hashed content,
  // so this never affects chain verification.
  let organisationId = spec.organisationId ?? null;
  if (!organisationId && spec.licenceId) {
    const lic = await db
      .select({ organisationId: licences.organisationId })
      .from(licences)
      .where(eq(licences.id, spec.licenceId))
      .get();
    organisationId = lic?.organisationId ?? null;
  }

  const id = crypto.randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);

  await db.insert(complianceEvents).values({
    id,
    chainKey: spec.chainKey,
    seq,
    eventType: spec.eventType,
    regime: spec.regime ?? "sag_aftra",
    clauseRef: spec.clauseRef ?? null,
    licenceId: spec.licenceId ?? null,
    talentId: spec.talentId ?? null,
    organisationId,
    actorId: spec.actorId ?? null,
    scopeJson: canonicalJson(spec.scope ?? {}),
    payloadJson: canonicalJson(payload),
    prevHash,
    hash,
    ipAddress: spec.ipAddress ?? null,
    userAgent: spec.userAgent ?? null,
    createdAt,
  });

  return { id, chainKey: spec.chainKey, seq, hash, prevHash, createdAt };
}

// Chain-key helpers — keep the `licence:` / `talent:` convention in one place.
export const licenceChain = (licenceId: string) => `licence:${licenceId}`;
export const talentChain = (talentId: string) => `talent:${talentId}`;
