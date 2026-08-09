/**
 * Document seals — turning "trust us, it's tamper-evident" into something a
 * reader can check for themselves.
 *
 * A seal snapshots the ledger state a document was built from: which chains it
 * covered, each chain's tip hash, and one SHA-256 over the sorted set. The
 * document prints that hash and a QR code pointing at /verify/{ref}. The public
 * endpoint reloads the chains, re-runs verifyChain(), recomputes the set hash,
 * and compares. A mismatch means the ledger moved after issuance; a chain break
 * means it was altered.
 *
 * No new crypto lives here — sha256Hex / canonicalJson / verifyChain all come
 * from lib/compliance/ledger.
 */

import { eq, inArray } from "drizzle-orm";
import { complianceEvents, documentSeals } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import type { HashedEvent } from "./types";
import { canonicalJson, sha256Hex, verifyChain } from "./ledger";

type Db = ReturnType<typeof getDb>;

/** A ledger event with the chain metadata a document needs to render it. */
export interface SealChainEvent extends HashedEvent {
  id: string;
  clauseRef: string | null;
  licenceId: string | null;
  talentId: string | null;
  actorId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  scope: unknown;
  createdAt: number;
}

export interface ChainStatus {
  chainKey: string;
  eventCount: number;
  tipHash: string;
  tipSeq: number;
  ok: boolean;
  brokenAtSeq?: number;
  reason?: string;
}

export interface ChainSetVerification {
  chains: ChainStatus[];
  /** SHA-256 over the sorted (chainKey, tipHash) pairs. Empty string when no chains carry events. */
  setHash: string;
  eventCount: number;
  /** True only when every chain verified. */
  ok: boolean;
  /** First failure, for the human-readable "broken at" line. */
  firstBreak: { chainKey: string; brokenAtSeq?: number; reason?: string } | null;
}

// ── Loading ──────────────────────────────────────────────────────────────────

function safeParse(json: string | null): unknown {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/**
 * Load every event on the given chains, ordered by chain then seq. One query —
 * a package with several licences would otherwise fan out per chain.
 */
export async function loadChainEvents(db: Db, chainKeys: string[]): Promise<Map<string, SealChainEvent[]>> {
  const byChain = new Map<string, SealChainEvent[]>();
  for (const key of chainKeys) byChain.set(key, []);
  if (chainKeys.length === 0) return byChain;

  const rows = await db
    .select()
    .from(complianceEvents)
    .where(inArray(complianceEvents.chainKey, chainKeys))
    .orderBy(complianceEvents.seq)
    .all();

  for (const r of rows) {
    const list = byChain.get(r.chainKey);
    if (!list) continue;
    list.push({
      id: r.id,
      chainKey: r.chainKey,
      seq: r.seq,
      eventType: r.eventType,
      payload: safeParse(r.payloadJson),
      prevHash: r.prevHash,
      hash: r.hash,
      clauseRef: r.clauseRef,
      licenceId: r.licenceId,
      talentId: r.talentId,
      actorId: r.actorId,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      scope: safeParse(r.scopeJson),
      createdAt: r.createdAt,
    });
  }

  // inArray does not guarantee per-chain ordering across chains — sort locally.
  for (const list of byChain.values()) list.sort((a, b) => a.seq - b.seq);
  return byChain;
}

// ── Set hashing ──────────────────────────────────────────────────────────────

/**
 * One hash over a set of chain tips. Sorted by chainKey so the result does not
 * depend on query order, and canonicalised so it does not depend on key order.
 *
 * Chains with no events contribute an empty tip rather than being dropped —
 * otherwise adding the first event to a previously-empty chain would be
 * indistinguishable from that chain never having been in scope.
 */
export async function chainSetHash(entries: Array<{ chainKey: string; tipHash: string }>): Promise<string> {
  if (entries.length === 0) return "";
  const sorted = [...entries]
    .map((e) => ({ chainKey: e.chainKey, tipHash: e.tipHash }))
    .sort((a, b) => a.chainKey.localeCompare(b.chainKey));
  return sha256Hex(canonicalJson(sorted));
}

// ── Verification ─────────────────────────────────────────────────────────────

/** Verify a set of chains and compute the seal hash over their tips. */
export async function verifyChainSet(db: Db, chainKeys: string[]): Promise<ChainSetVerification> {
  const byChain = await loadChainEvents(db, chainKeys);

  const chains: ChainStatus[] = [];
  let eventCount = 0;
  let firstBreak: ChainSetVerification["firstBreak"] = null;

  for (const key of [...chainKeys].sort()) {
    const events = byChain.get(key) ?? [];
    eventCount += events.length;

    const result = await verifyChain(events);
    const tip = events.length ? events[events.length - 1] : null;
    const status: ChainStatus = {
      chainKey: key,
      eventCount: events.length,
      tipHash: tip?.hash ?? "",
      tipSeq: tip?.seq ?? -1,
      ok: result.ok,
    };
    if (!result.ok) {
      status.brokenAtSeq = result.brokenAtSeq;
      status.reason = result.reason;
      if (!firstBreak) {
        firstBreak = { chainKey: key, brokenAtSeq: result.brokenAtSeq, reason: result.reason };
      }
    }
    chains.push(status);
  }

  const setHash = await chainSetHash(chains.map((c) => ({ chainKey: c.chainKey, tipHash: c.tipHash })));

  return { chains, setHash, eventCount, ok: chains.every((c) => c.ok), firstBreak };
}

// ── Minting ──────────────────────────────────────────────────────────────────

const REF_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REF_LENGTH = 22;

/**
 * An opaque, URL-safe reference. ~128 bits over an alphabet with the
 * easily-confused glyphs (l/1/I, o/0/O) removed, because people read these off
 * paper. Rejection-sampled so the modulo does not skew the distribution.
 */
export function mintRef(): string {
  const out: string[] = [];
  const limit = 256 - (256 % REF_ALPHABET.length);
  while (out.length < REF_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(REF_LENGTH));
    for (const b of bytes) {
      if (b >= limit) continue; // would bias the distribution
      out.push(REF_ALPHABET[b % REF_ALPHABET.length]);
      if (out.length === REF_LENGTH) break;
    }
  }
  return out.join("");
}

export type SealKind = "custody_record" | "consent_receipt" | "certificate";
export type SealSubjectType = "package" | "licence" | "cast" | "talent";

export interface MintSealInput {
  kind: SealKind;
  subjectType: SealSubjectType;
  subjectId: string;
  /**
   * Shown on the PUBLIC verification page. Initials and a short code only —
   * never a name, email, production, or company. Callers must pass a value that
   * is safe to show a stranger who scanned a QR code off a printout.
   */
  subjectLabel?: string | null;
  chainKeys: string[];
  issuedBy?: string | null;
}

export interface MintedSeal {
  id: string;
  ref: string;
  sealHash: string;
  eventCount: number;
  issuedAt: number;
  verification: ChainSetVerification;
}

/**
 * Issue a seal for the current ledger state.
 *
 * Re-mints rather than reusing: a document issued today and reprinted next
 * month covers a longer ledger, and its seal must reflect what was actually on
 * the page. Old seals stay valid for the copies already in circulation — that
 * is the point of an append-only chain, and it is how a reader can tell a
 * document is an older extract rather than a forgery.
 */
export async function mintSeal(db: Db, input: MintSealInput): Promise<MintedSeal> {
  const verification = await verifyChainSet(db, input.chainKeys);
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  const ref = mintRef();

  await db.insert(documentSeals).values({
    id,
    ref,
    kind: input.kind,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    subjectLabel: input.subjectLabel ?? null,
    chainKeysJson: JSON.stringify([...input.chainKeys].sort()),
    chainSummaryJson: JSON.stringify(
      verification.chains.map((c) => ({
        chainKey: c.chainKey,
        seq: c.tipSeq,
        tipHash: c.tipHash,
        eventCount: c.eventCount,
      })),
    ),
    sealHash: verification.setHash,
    eventCount: verification.eventCount,
    issuedBy: input.issuedBy ?? null,
    issuedAt: now,
  });

  return { id, ref, sealHash: verification.setHash, eventCount: verification.eventCount, issuedAt: now, verification };
}

/**
 * Find the most recent live seal for a subject, or mint one. Keeps a printed
 * QR stable across reloads of the same unchanged document instead of minting a
 * row on every page view.
 */
export async function getOrMintSeal(db: Db, input: MintSealInput): Promise<MintedSeal> {
  const existing = await db
    .select()
    .from(documentSeals)
    .where(eq(documentSeals.subjectId, input.subjectId))
    .all();

  const live = existing
    .filter((s) => s.kind === input.kind && s.subjectType === input.subjectType && s.revokedAt == null)
    .sort((a, b) => b.issuedAt - a.issuedAt)[0];

  if (live) {
    const verification = await verifyChainSet(db, input.chainKeys);
    // The ledger has not moved since this seal was issued — reuse it, so the QR
    // on a document the reader already printed keeps resolving to the same page.
    if (verification.setHash === live.sealHash) {
      return {
        id: live.id,
        ref: live.ref,
        sealHash: live.sealHash,
        eventCount: live.eventCount,
        issuedAt: live.issuedAt,
        verification,
      };
    }
  }

  return mintSeal(db, input);
}

// ── Public verification ──────────────────────────────────────────────────────

export interface SealVerdict {
  /**
   * intact   — chains verify and the recomputed set hash matches the seal
   * appended — chains verify but the ledger has grown since issuance
   * broken   — a chain failed to verify, or the tip changed without growing
   * revoked  — the seal was withdrawn
   */
  status: "intact" | "appended" | "broken" | "revoked";
  kind: SealKind;
  subjectLabel: string | null;
  issuedAt: number;
  verifiedAt: number;
  sealedHash: string;
  currentHash: string;
  sealedEventCount: number;
  currentEventCount: number;
  detail: string;
}

/**
 * Verify a seal by its public ref. Returns null when the ref is unknown.
 *
 * The caller is unauthenticated, so the result carries no names, emails, event
 * types, or timestamps beyond issue/verify — only whether the record holds.
 */
export async function verifySealByRef(db: Db, ref: string): Promise<SealVerdict | null> {
  const seal = await db.select().from(documentSeals).where(eq(documentSeals.ref, ref)).get();
  if (!seal) return null;

  const verifiedAt = Math.floor(Date.now() / 1000);
  const base = {
    kind: seal.kind as SealKind,
    subjectLabel: seal.subjectLabel,
    issuedAt: seal.issuedAt,
    verifiedAt,
    sealedHash: seal.sealHash,
    sealedEventCount: seal.eventCount,
  };

  if (seal.revokedAt != null) {
    return {
      ...base,
      status: "revoked",
      currentHash: "",
      currentEventCount: 0,
      detail: "This document was withdrawn by its issuer and should not be relied on.",
    };
  }

  let chainKeys: string[] = [];
  try {
    const parsed: unknown = JSON.parse(seal.chainKeysJson);
    if (Array.isArray(parsed)) chainKeys = parsed.filter((k): k is string => typeof k === "string");
  } catch {
    chainKeys = [];
  }

  const verification = await verifyChainSet(db, chainKeys);

  if (!verification.ok) {
    const at = verification.firstBreak?.brokenAtSeq;
    return {
      ...base,
      status: "broken",
      currentHash: verification.setHash,
      currentEventCount: verification.eventCount,
      detail:
        at != null
          ? `The ledger failed verification at entry ${at}: ${verification.firstBreak?.reason ?? "content altered"}.`
          : "The ledger failed verification.",
    };
  }

  if (verification.setHash === seal.sealHash) {
    return {
      ...base,
      status: "intact",
      currentHash: verification.setHash,
      currentEventCount: verification.eventCount,
      detail: "The ledger is unchanged since this document was issued, and every entry verifies against the one before it.",
    };
  }

  // Hash moved but every chain still verifies. On an append-only ledger the only
  // way that happens is new events — which is normal, not tampering. Growth is
  // the check that separates the two.
  if (verification.eventCount > seal.eventCount) {
    return {
      ...base,
      status: "appended",
      currentHash: verification.setHash,
      currentEventCount: verification.eventCount,
      detail: `Every entry verifies, and ${verification.eventCount - seal.eventCount} further entr${
        verification.eventCount - seal.eventCount === 1 ? "y has" : "ies have"
      } been recorded since this document was issued. The document remains an accurate extract as at its issue date; request a current copy for the full record.`,
    };
  }

  return {
    ...base,
    status: "broken",
    currentHash: verification.setHash,
    currentEventCount: verification.eventCount,
    detail:
      "The sealed hash does not match the current ledger, and the ledger has not grown. Entries recorded at issue are missing.",
  };
}
