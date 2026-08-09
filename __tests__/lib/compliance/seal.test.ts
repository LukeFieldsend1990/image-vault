import { describe, it, expect, beforeEach, vi } from "vitest";
import { hashEvent } from "@/lib/compliance/ledger";
import {
  chainSetHash,
  mintRef,
  verifyChainSet,
  verifySealByRef,
} from "@/lib/compliance/seal";
import { createTestEnv } from "../../helpers/mocks";

const t = createTestEnv();

/**
 * Build a real, valid hash chain and shape it the way loadChainEvents reads it
 * back off a `select()` with no projection — camelCase columns, payload still
 * serialised in `payloadJson`.
 */
async function buildChainRows(chainKey: string, eventTypes: string[]) {
  const rows: Record<string, unknown>[] = [];
  let prev = chainKey;
  for (let i = 0; i < eventTypes.length; i++) {
    const payload = { i };
    const e = await hashEvent({ chainKey, seq: i, eventType: eventTypes[i], payload }, prev);
    rows.push({
      id: `ev-${chainKey}-${i}`,
      chainKey,
      seq: i,
      eventType: eventTypes[i],
      payloadJson: JSON.stringify(payload),
      prevHash: e.prevHash,
      hash: e.hash,
      clauseRef: null,
      licenceId: null,
      talentId: null,
      actorId: null,
      ipAddress: null,
      userAgent: null,
      scopeJson: null,
      createdAt: 1000 + i,
    });
    prev = e.hash;
  }
  return rows;
}

describe("chainSetHash", () => {
  it("is stable regardless of the order chains are supplied in", async () => {
    const a = await chainSetHash([
      { chainKey: "licence:B", tipHash: "bbb" },
      { chainKey: "licence:A", tipHash: "aaa" },
    ]);
    const b = await chainSetHash([
      { chainKey: "licence:A", tipHash: "aaa" },
      { chainKey: "licence:B", tipHash: "bbb" },
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any tip changes", async () => {
    const before = await chainSetHash([{ chainKey: "licence:A", tipHash: "aaa" }]);
    const after = await chainSetHash([{ chainKey: "licence:A", tipHash: "aab" }]);
    expect(before).not.toBe(after);
  });

  it("distinguishes an empty chain from an absent one", async () => {
    const withEmpty = await chainSetHash([
      { chainKey: "licence:A", tipHash: "aaa" },
      { chainKey: "talent:T", tipHash: "" },
    ]);
    const without = await chainSetHash([{ chainKey: "licence:A", tipHash: "aaa" }]);
    expect(withEmpty).not.toBe(without);
  });

  it("returns an empty string when there are no chains at all", async () => {
    expect(await chainSetHash([])).toBe("");
  });
});

describe("mintRef", () => {
  it("is 22 URL-safe characters with no confusable pair left in the alphabet", () => {
    // l/I/1 and O/0 are dropped so that each remaining glyph is unambiguous when
    // read off paper. Lowercase o and uppercase L survive precisely because the
    // characters they could be mistaken for are gone.
    for (let i = 0; i < 50; i++) {
      const ref = mintRef();
      expect(ref).toHaveLength(22);
      expect(ref).toMatch(/^[A-Za-z0-9]{22}$/);
      expect(ref).not.toMatch(/[lI1O0]/);
    }
  });

  it("does not repeat across many draws", () => {
    const seen = new Set(Array.from({ length: 500 }, () => mintRef()));
    expect(seen.size).toBe(500);
  });
});

describe("verifyChainSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("verifies an intact chain and reports its tip", async () => {
    const rows = await buildChainRows("licence:L1", ["consent.granted", "custody.talent_verified"]);
    t.enqueue(rows);

    const result = await verifyChainSet(t.db as never, ["licence:L1"]);

    expect(result.ok).toBe(true);
    expect(result.eventCount).toBe(2);
    expect(result.chains[0].tipHash).toBe(rows[1].hash);
    expect(result.setHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.firstBreak).toBeNull();
  });

  it("detects an altered payload and names the entry it broke at", async () => {
    const rows = await buildChainRows("licence:L1", ["consent.granted", "consent.revoked", "use.metered"]);
    // Tamper with the middle entry the way a database edit would: the content
    // changes but the stored hash does not.
    rows[1].payloadJson = JSON.stringify({ i: 99 });
    t.enqueue(rows);

    const result = await verifyChainSet(t.db as never, ["licence:L1"]);

    expect(result.ok).toBe(false);
    expect(result.firstBreak?.brokenAtSeq).toBe(1);
    expect(result.chains[0].reason).toMatch(/altered/i);
  });

  it("detects a removed entry as a sequence discontinuity", async () => {
    const rows = await buildChainRows("licence:L1", ["a", "b", "c"]);
    rows.splice(1, 1); // delete the middle entry
    t.enqueue(rows);

    const result = await verifyChainSet(t.db as never, ["licence:L1"]);

    expect(result.ok).toBe(false);
    expect(result.firstBreak?.reason).toMatch(/seq discontinuity/i);
  });

  it("treats a chain with no events as verified but empty", async () => {
    t.enqueue([]);
    const result = await verifyChainSet(t.db as never, ["talent:T1"]);
    expect(result.ok).toBe(true);
    expect(result.eventCount).toBe(0);
    expect(result.chains[0].tipHash).toBe("");
  });
});

describe("verifySealByRef", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  const sealRow = (over: Record<string, unknown> = {}) => ({
    id: "seal-1",
    ref: "aBcDeFgHiJkLmNoPqRsTuV",
    kind: "custody_record",
    subjectType: "package",
    subjectId: "pkg-1",
    subjectLabel: "JD · JD-S01",
    chainKeysJson: JSON.stringify(["licence:L1"]),
    chainSummaryJson: "[]",
    sealHash: "placeholder",
    eventCount: 2,
    issuedBy: "user-1",
    issuedAt: 1700000000,
    revokedAt: null,
    ...over,
  });

  it("returns null for an unknown ref", async () => {
    t.enqueue(undefined);
    expect(await verifySealByRef(t.db as never, "nope")).toBeNull();
  });

  it("reports intact when the ledger has not moved since issue", async () => {
    const rows = await buildChainRows("licence:L1", ["consent.granted", "custody.talent_verified"]);
    const sealHash = await chainSetHash([{ chainKey: "licence:L1", tipHash: rows[1].hash as string }]);

    t.enqueue(sealRow({ sealHash }));
    t.enqueue(rows);

    const v = await verifySealByRef(t.db as never, "aBcDeFgHiJkLmNoPqRsTuV");

    expect(v?.status).toBe("intact");
    expect(v?.currentHash).toBe(sealHash);
    expect(v?.currentEventCount).toBe(2);
  });

  it("reports appended — not broken — when new entries were added after issue", async () => {
    // Seal was issued over the first two entries; a third has since been chained.
    const twoRows = await buildChainRows("licence:L1", ["consent.granted", "custody.talent_verified"]);
    const sealHash = await chainSetHash([{ chainKey: "licence:L1", tipHash: twoRows[1].hash as string }]);
    const threeRows = await buildChainRows("licence:L1", [
      "consent.granted",
      "custody.talent_verified",
      "use.metered",
    ]);

    t.enqueue(sealRow({ sealHash, eventCount: 2 }));
    t.enqueue(threeRows);

    const v = await verifySealByRef(t.db as never, "aBcDeFgHiJkLmNoPqRsTuV");

    expect(v?.status).toBe("appended");
    expect(v?.currentEventCount).toBe(3);
    expect(v?.detail).toMatch(/further entry has been recorded/i);
  });

  it("reports broken when an entry was altered", async () => {
    const rows = await buildChainRows("licence:L1", ["consent.granted", "consent.revoked"]);
    const sealHash = await chainSetHash([{ chainKey: "licence:L1", tipHash: rows[1].hash as string }]);
    rows[0].payloadJson = JSON.stringify({ i: 42 });

    t.enqueue(sealRow({ sealHash }));
    t.enqueue(rows);

    const v = await verifySealByRef(t.db as never, "aBcDeFgHiJkLmNoPqRsTuV");

    expect(v?.status).toBe("broken");
    expect(v?.detail).toMatch(/entry 0/);
  });

  it("reports broken when entries present at issue have gone missing", async () => {
    // Chain still verifies, but it is shorter than it was — the one case a naive
    // hash comparison would misreport as a benign change.
    const twoRows = await buildChainRows("licence:L1", ["consent.granted", "custody.talent_verified"]);
    const sealHash = await chainSetHash([{ chainKey: "licence:L1", tipHash: twoRows[1].hash as string }]);
    const oneRow = await buildChainRows("licence:L1", ["consent.granted"]);

    t.enqueue(sealRow({ sealHash, eventCount: 2 }));
    t.enqueue(oneRow);

    const v = await verifySealByRef(t.db as never, "aBcDeFgHiJkLmNoPqRsTuV");

    expect(v?.status).toBe("broken");
    expect(v?.detail).toMatch(/missing/i);
  });

  it("reports revoked without touching the ledger", async () => {
    t.enqueue(sealRow({ revokedAt: 1700001000 }));

    const v = await verifySealByRef(t.db as never, "aBcDeFgHiJkLmNoPqRsTuV");

    expect(v?.status).toBe("revoked");
    expect(v?.currentEventCount).toBe(0);
  });

  it("never returns a name or an email — only the label minted for public display", async () => {
    const rows = await buildChainRows("licence:L1", ["consent.granted"]);
    const sealHash = await chainSetHash([{ chainKey: "licence:L1", tipHash: rows[0].hash as string }]);
    t.enqueue(sealRow({ sealHash, eventCount: 1 }));
    t.enqueue(rows);

    const v = await verifySealByRef(t.db as never, "aBcDeFgHiJkLmNoPqRsTuV");

    const serialised = JSON.stringify(v);
    expect(serialised).not.toMatch(/@/); // no email addresses
    expect(Object.keys(v!).sort()).toEqual(
      [
        "currentEventCount",
        "currentHash",
        "detail",
        "issuedAt",
        "kind",
        "sealedEventCount",
        "sealedHash",
        "status",
        "subjectLabel",
        "verifiedAt",
      ].sort(),
    );
  });
});
