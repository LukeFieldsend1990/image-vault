import { describe, it, expect } from "vitest";
import {
  canonicalJson,
  computeNext,
  hashEvent,
  verifyChain,
  licenceChain,
  talentChain,
} from "@/lib/compliance/ledger";
import type { HashedEvent } from "@/lib/compliance/types";

// Build a valid chain off a chain_key for the given event types.
async function buildChain(chainKey: string, eventTypes: string[]): Promise<HashedEvent[]> {
  const chain: HashedEvent[] = [];
  for (let i = 0; i < eventTypes.length; i++) {
    const prevHash = i === 0 ? chainKey : chain[i - 1].hash;
    chain.push(await hashEvent({ chainKey, seq: i, eventType: eventTypes[i], payload: { i } }, prevHash));
  }
  return chain;
}

describe("canonicalJson", () => {
  it("sorts object keys recursively so key order does not matter", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(canonicalJson({ x: { d: 4, c: 3 } })).toBe('{"x":{"c":3,"d":4}}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("computeNext", () => {
  it("genesis: null tip -> seq 0, prevHash = chainKey", () => {
    expect(computeNext("licence:L1", null)).toEqual({ seq: 0, prevHash: "licence:L1" });
  });

  it("advances seq and chains off the tip hash", () => {
    expect(computeNext("licence:L1", { seq: 3, hash: "abc" })).toEqual({ seq: 4, prevHash: "abc" });
  });
});

describe("hashEvent", () => {
  it("first event chains off the chain_key as genesis prev_hash", async () => {
    const e = await hashEvent(
      { chainKey: "licence:L1", seq: 0, eventType: "consent.granted", payload: {} },
      "licence:L1",
    );
    expect(e.prevHash).toBe("licence:L1");
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input ⇒ same hash regardless of payload key order", async () => {
    const a = await hashEvent({ chainKey: "licence:L1", seq: 1, eventType: "x", payload: { b: 2, a: 1 } }, "PREV");
    const b = await hashEvent({ chainKey: "licence:L1", seq: 1, eventType: "x", payload: { a: 1, b: 2 } }, "PREV");
    expect(a.hash).toBe(b.hash);
  });

  it("a different prevHash yields a different hash (chaining is real)", async () => {
    const a = await hashEvent({ chainKey: "licence:L1", seq: 1, eventType: "x", payload: {} }, "PREV_A");
    const b = await hashEvent({ chainKey: "licence:L1", seq: 1, eventType: "x", payload: {} }, "PREV_B");
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("verifyChain", () => {
  it("accepts a well-formed chain", async () => {
    const chain = await buildChain("licence:L1", ["consent.granted", "consent.dub_language_granted", "consent.revoked"]);
    expect(await verifyChain(chain)).toEqual({ ok: true });
  });

  it("detects tampering — mutating a middle event breaks verification", async () => {
    const chain = await buildChain("licence:L1", ["a", "b", "c"]);
    chain[1] = { ...chain[1], payload: { tampered: true } };
    const result = await verifyChain(chain);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.brokenAtSeq).toBe(1);
  });

  it("detects deletion — removing an event breaks seq continuity", async () => {
    const chain = await buildChain("licence:L1", ["a", "b", "c"]);
    const result = await verifyChain([chain[0], chain[2]]);
    expect(result.ok).toBe(false);
  });

  it("detects a re-pointed prev_hash", async () => {
    const chain = await buildChain("licence:L1", ["a", "b"]);
    chain[1] = { ...chain[1], prevHash: "forged" };
    expect((await verifyChain(chain)).ok).toBe(false);
  });
});

describe("chain key helpers", () => {
  it("namespaces by entity", () => {
    expect(licenceChain("L1")).toBe("licence:L1");
    expect(talentChain("T1")).toBe("talent:T1");
  });
});
