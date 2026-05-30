import { describe, it, expect } from "vitest";
import { hashEvent } from "@/lib/compliance/ledger";
import { verifyLedgerEvents, computeScopeTip } from "@/lib/compliance/certificate";
import type { HashedEvent } from "@/lib/compliance/types";

async function chain(chainKey: string, types: string[]): Promise<HashedEvent[]> {
  const out: HashedEvent[] = [];
  for (let i = 0; i < types.length; i++) {
    const prev = i === 0 ? chainKey : out[i - 1].hash;
    out.push(await hashEvent({ chainKey, seq: i, eventType: types[i], payload: { i } }, prev));
  }
  return out;
}

describe("verifyLedgerEvents", () => {
  it("an empty chain verifies with an empty tip", async () => {
    expect(await verifyLedgerEvents([])).toEqual({ ok: true, tipHash: "" });
  });

  it("a valid chain verifies and returns the last hash as the tip", async () => {
    const c = await chain("licence:L1", ["consent.granted", "biometric.isolation_attested"]);
    const r = await verifyLedgerEvents(c);
    expect(r.ok).toBe(true);
    expect(r.tipHash).toBe(c[1].hash);
  });

  it("a tampered chain fails verification", async () => {
    const c = await chain("licence:L1", ["a", "b", "c"]);
    c[1] = { ...c[1], payload: { i: 999 } }; // hash no longer matches content
    const r = await verifyLedgerEvents(c);
    expect(r.ok).toBe(false);
    expect(r.brokenAtSeq).toBe(1);
  });
});

describe("computeScopeTip", () => {
  it("is stable regardless of per-licence ordering", async () => {
    const a = await computeScopeTip([{ licenceId: "L1", tip: "h1" }, { licenceId: "L2", tip: "h2" }]);
    const b = await computeScopeTip([{ licenceId: "L2", tip: "h2" }, { licenceId: "L1", tip: "h1" }]);
    expect(a).toBe(b);
  });

  it("changes when a tip changes", async () => {
    const a = await computeScopeTip([{ licenceId: "L1", tip: "h1" }]);
    const b = await computeScopeTip([{ licenceId: "L1", tip: "h1-altered" }]);
    expect(a).not.toBe(b);
  });
});
