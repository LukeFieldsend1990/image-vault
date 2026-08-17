import { describe, it, expect } from "vitest";
import { hashEvent, verifyChain, computeNext, canonicalJson } from "@/lib/compliance/ledger";
import type { HashedEvent } from "@/lib/compliance/types";
import { isoUtc } from "@/lib/documents/palette";

/**
 * The probe ledger helper (lib/probe/ledger.ts) folds the run's timestamp,
 * actor, and artifact hashes INTO the hashed payload precisely so they are
 * tamper-evident — unlike the general ledger's DB `createdAt`/`actorId` columns,
 * which sit outside the hash. These tests pin that property using the same pure
 * hashing the helper builds on: alter the payload timestamp and verification
 * must fail.
 */

async function buildChain(chainKey: string, payloads: unknown[]): Promise<HashedEvent[]> {
  const chain: HashedEvent[] = [];
  let tip: { seq: number; hash: string } | null = null;
  for (const payload of payloads) {
    const { seq, prevHash } = computeNext(chainKey, tip);
    const event = await hashEvent(
      { chainKey, seq, eventType: "probe.run_completed", payload },
      prevHash
    );
    chain.push(event);
    tip = { seq: event.seq, hash: event.hash };
  }
  return chain;
}

describe("probe ledger payload is tamper-evident", () => {
  const chainKey = "talent:abc";
  const at = 1_760_000_000;

  it("verifies a well-formed chain whose payload carries the timestamp", async () => {
    const chain = await buildChain(chainKey, [
      { at: isoUtc(at), atUnix: at, runId: "r1", manifestSha256: "f".repeat(64) },
    ]);
    expect((await verifyChain(chain)).ok).toBe(true);
  });

  it("breaks verification when the payload timestamp is altered after sealing", async () => {
    const chain = await buildChain(chainKey, [
      { at: isoUtc(at), atUnix: at, runId: "r1" },
    ]);
    // Tamper: move the recorded completion time forward a day, keep the hash.
    chain[0].payload = { at: isoUtc(at + 86_400), atUnix: at + 86_400, runId: "r1" };
    const result = await verifyChain(chain);
    expect(result.ok).toBe(false);
  });

  it("breaks verification when the artifact hash in the payload is swapped", async () => {
    const chain = await buildChain(chainKey, [
      { at: isoUtc(at), runId: "r1", manifestSha256: "a".repeat(64) },
    ]);
    chain[0].payload = { at: isoUtc(at), runId: "r1", manifestSha256: "b".repeat(64) };
    expect((await verifyChain(chain)).ok).toBe(false);
  });

  it("canonicalises payloads so key order does not affect the hash", async () => {
    const c1 = await buildChain(chainKey, [{ at: isoUtc(at), runId: "r1" }]);
    const c2 = await buildChain(chainKey, [{ runId: "r1", at: isoUtc(at) }]);
    expect(c1[0].hash).toBe(c2[0].hash);
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
});
