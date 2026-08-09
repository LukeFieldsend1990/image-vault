import { describe, it, expect, beforeEach, vi } from "vitest";
import { partitionUses, receiptReference, buildConsentReceipt } from "@/lib/consent/receipt";
import { USE_CATEGORIES } from "@/lib/consent/use-categories";
import { createTestEnv } from "../../helpers/mocks";

const t = createTestEnv();

describe("partitionUses", () => {
  it("is exhaustive — every category lands in exactly one list", () => {
    const { granted, withheld } = partitionUses(["reuse", "training"]);
    expect(granted.length + withheld.length).toBe(USE_CATEGORIES.length);

    const ids = [...granted, ...withheld].map((u) => u.id).sort();
    expect(ids).toEqual(USE_CATEGORIES.map((c) => c.id).sort());
  });

  it("puts the granted ids in granted and everything else in withheld", () => {
    const { granted, withheld } = partitionUses(["reuse", "training"]);
    expect(granted.map((u) => u.id)).toEqual(["reuse", "training"]);
    expect(withheld.map((u) => u.id)).toEqual(["vfx-this", "dub", "replica", "marketing"]);
  });

  it("preserves canonical taxonomy order regardless of input order", () => {
    const a = partitionUses(["training", "vfx-this", "dub"]);
    const b = partitionUses(["dub", "training", "vfx-this"]);
    expect(a.granted.map((u) => u.id)).toEqual(b.granted.map((u) => u.id));
    expect(a.granted.map((u) => u.id)).toEqual(["vfx-this", "dub", "training"]);
  });

  it("withholds everything when nothing was granted — refusal is a real answer", () => {
    const { granted, withheld } = partitionUses([]);
    expect(granted).toHaveLength(0);
    expect(withheld).toHaveLength(USE_CATEGORIES.length);
  });

  it("grants everything when the whole taxonomy was ticked", () => {
    const { granted, withheld } = partitionUses(USE_CATEGORIES.map((c) => c.id));
    expect(granted).toHaveLength(USE_CATEGORIES.length);
    expect(withheld).toHaveLength(0);
  });

  it("drops unknown ids rather than inventing a row for them", () => {
    const { granted, withheld } = partitionUses(["reuse", "not-a-real-category"]);
    expect(granted.map((u) => u.id)).toEqual(["reuse"]);
    expect(granted.length + withheld.length).toBe(USE_CATEGORIES.length);
  });

  it("carries the regime tag and sensitivity flag through to the receipt rows", () => {
    const { granted } = partitionUses(["replica", "training"]);
    expect(granted.every((u) => u.sensitive)).toBe(true);
    expect(granted.map((u) => u.regimeTag)).toEqual(["§39E", "§39G"]);
  });
});

describe("receiptReference", () => {
  it("is a dated, quotable reference derived from the acceptance id", () => {
    // 2026-06-15T00:00:00Z
    const ref = receiptReference("a1b2c3d4-e5f6-7890-abcd-ef1234567890", 1781481600);
    expect(ref).toMatch(/^CR-\d{8}-[0-9A-F]{6}$/);
    expect(ref).toBe("CR-20260615-A1B2C3");
  });

  it("is stable for the same acceptance", () => {
    expect(receiptReference("x-y-z", 1781481600)).toBe(receiptReference("x-y-z", 1781481600));
  });
});

describe("buildConsentReceipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns null when the acceptance does not exist", async () => {
    t.enqueue(undefined);
    expect(await buildConsentReceipt(t.db as never, "missing")).toBeNull();
  });

  it("builds a guest receipt and marks it as not yet chained", async () => {
    t.enqueue({
      id: "acc-1",
      licenceId: null,
      castId: "cast-1",
      talentId: null,
      acceptedByEmail: "performer@example.com",
      acceptedByRole: "guest",
      usesConsentedJson: JSON.stringify(["vfx-this", "dub"]),
      documentVersion: "2026.06",
      ipHash: "a".repeat(64),
      userAgentHash: "b".repeat(64),
      attestedAt: 1781481600,
      replayedAt: null,
    });
    t.enqueue({ actorName: "Jane Doe", productionId: "prod-1" }); // productionCast
    t.enqueue({ name: "The Fifth Season", organisationId: "org-1" }); // productions
    t.enqueue({ name: "Northlight Pictures" }); // organisations

    const r = await buildConsentReceipt(t.db as never, "acc-1");

    expect(r).not.toBeNull();
    expect(r!.performerName).toBe("Jane Doe");
    expect(r!.productionName).toBe("The Fifth Season");
    expect(r!.companyName).toBe("Northlight Pictures");
    expect(r!.acceptedByRole).toBe("guest");
    expect(r!.onBehalf).toBe(false);

    expect(r!.granted.map((u) => u.id)).toEqual(["vfx-this", "dub"]);
    expect(r!.withheld.map((u) => u.id)).toEqual(["reuse", "replica", "training", "marketing"]);

    // No account yet, so nothing has been written to the hash chain.
    expect(r!.chained).toBe(false);
    expect(r!.chainKeys).toEqual([]);
    expect(r!.granted.every((u) => u.ledger === null)).toBe(true);

    // The performer's own address is still reachable for the receipt email.
    expect(r!.performerEmail).toBe("performer@example.com");
    expect(r!.reference).toBe("CR-20260615-ACC1");
  });

  it("cites the ledger position of each grant on a chained acceptance", async () => {
    t.enqueue({
      id: "acc-2",
      licenceId: "lic-1",
      castId: null,
      talentId: "talent-1",
      acceptedByEmail: "agent@example.com",
      acceptedByRole: "rep",
      usesConsentedJson: JSON.stringify(["reuse"]),
      documentVersion: "2026.06",
      ipHash: null,
      userAgentHash: null,
      attestedAt: 1781481600,
      replayedAt: 1781481600,
    });
    t.enqueue({ talentId: "talent-1", projectName: "Ravensmoor", productionCompany: "Bellhouse Films" });
    t.enqueue({ fullName: "Jane Doe" }); // talentProfiles
    t.enqueue({ email: "jane@example.com" }); // users
    t.enqueue([{ useType: "reuse", grantedEventId: "ev-1", status: "granted", language: null }]);
    t.enqueue([
      { id: "ev-1", chainKey: "licence:lic-1", seq: 4, hash: "f".repeat(64), createdAt: 1781481601 },
    ]);

    const r = await buildConsentReceipt(t.db as never, "acc-2");

    expect(r!.onBehalf).toBe(true);
    expect(r!.acceptedByEmail).toBe("agent@example.com");
    expect(r!.performerEmail).toBe("jane@example.com");

    expect(r!.chained).toBe(true);
    expect(r!.chainKeys).toEqual(["licence:lic-1"]);

    const reuse = r!.granted.find((u) => u.id === "reuse");
    expect(reuse!.ledger).toEqual({ chainKey: "licence:lic-1", seq: 4, hash: "f".repeat(64) });
    expect(reuse!.grantedAt).toBe(1781481601);

    // Withheld rows never carry a ledger position — there is no grant to cite.
    expect(r!.withheld.every((u) => u.ledger === null)).toBe(true);
  });
});
