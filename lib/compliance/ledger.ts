// Append-only, hash-chained compliance ledger (SPEC §16.5).
//
// Each chain (keyed by `licence:{id}` or `talent:{id}`) seals every event into
// the next: hash = SHA-256(prevHash + canonicalJson(content)). The genesis
// event's prevHash is the chain_key itself. Any retroactive edit or deletion
// breaks verifyChain(), and the certificate (§16.12) embeds the tip hash as a
// tamper seal.

import { desc, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { complianceEvents } from "@/lib/db/schema";
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

// Append a new event to a chain. Reads the tip, computes seq + prev_hash, hashes
// the canonical content, and inserts. The unique index on (chain_key, seq)
// serialises concurrent appends — a racing duplicate seq throws and the caller
// retries. Events are human-paced (consent/strike/transfer), so contention is rare.
export async function appendEvent(db: Db, spec: AppendEventSpec): Promise<AppendedEvent> {
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
    organisationId: spec.organisationId ?? null,
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
