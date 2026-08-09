import { describe, it, expect } from "vitest";
import { buildRedline, summariseRedline } from "@/lib/consent/redline";
import { USE_CATEGORIES } from "@/lib/consent/use-categories";
import type { NegotiationRound } from "@/lib/consent/negotiation";

let seq = 0;
function round(over: Partial<NegotiationRound> = {}): NegotiationRound {
  seq += 1;
  return {
    id: `r${seq}`,
    round: seq,
    party: "talent",
    action: "counter",
    scope: [],
    fee: null,
    comment: null,
    createdAt: 1_700_000_000 + seq,
    ...over,
  } as NegotiationRound;
}

describe("buildRedline — scope", () => {
  it("treats the first round as the baseline when no opening position is known", () => {
    const [entry] = buildRedline({ rounds: [round({ scope: ["vfx-this", "reuse"] })] });
    expect(entry.isBaseline).toBe(true);
    expect(entry.added).toEqual([]);
    expect(entry.removed).toEqual([]);
    expect(entry.unchanged).toEqual(["vfx-this", "reuse"]);
  });

  it("diffs against a supplied opening position", () => {
    const [entry] = buildRedline({
      rounds: [round({ scope: ["vfx-this", "training"] })],
      baseline: { scope: ["vfx-this", "reuse"], fee: null },
    });
    expect(entry.isBaseline).toBe(false);
    expect(entry.added).toEqual(["training"]);
    expect(entry.removed).toEqual(["reuse"]);
    expect(entry.unchanged).toEqual(["vfx-this"]);
  });

  it("reports additions and removals in canonical taxonomy order, not input order", () => {
    const [entry] = buildRedline({
      rounds: [round({ scope: ["marketing", "dub", "replica"] })],
      baseline: { scope: [], fee: null },
    });
    // Declaration order in USE_CATEGORIES is vfx-this, reuse, dub, replica, training, marketing.
    expect(entry.added).toEqual(["dub", "replica", "marketing"]);
  });

  it("chains each round against the one before it", () => {
    const entries = buildRedline({
      rounds: [
        round({ scope: ["vfx-this"] }),
        round({ scope: ["vfx-this", "reuse"], party: "producer" }),
        round({ scope: ["reuse"] }),
      ],
      baseline: { scope: ["vfx-this"], fee: null },
    });
    expect(entries[0].added).toEqual([]);
    expect(entries[1].added).toEqual(["reuse"]);
    expect(entries[2].removed).toEqual(["vfx-this"]);
    expect(entries[2].added).toEqual([]);
  });

  it("flags a round that moved nothing rather than rendering it blank", () => {
    const entries = buildRedline({
      rounds: [round({ scope: ["vfx-this"] })],
      baseline: { scope: ["vfx-this"], fee: null },
    });
    expect(entries[0].unchangedEntirely).toBe(true);
    expect(summariseRedline(entries[0])).toBe("No change recorded");
  });
});

describe("buildRedline — the declined-round trap", () => {
  it("does not read a decline's empty scope as withdrawing every use", () => {
    const entries = buildRedline({
      rounds: [round({ action: "declined", comment: "Cannot agree on fee" })],
      baseline: { scope: ["vfx-this", "reuse", "training"], fee: 50_000 },
    });
    expect(entries[0].scopeStated).toBe(false);
    expect(entries[0].removed).toEqual([]);
    expect(entries[0].added).toEqual([]);
    expect(summariseRedline(entries[0])).toBe("No terms stated");
  });

  it("does not let a decline become the comparison point for anything after it", () => {
    const entries = buildRedline({
      rounds: [
        round({ scope: ["vfx-this", "reuse"] }),
        round({ action: "declined" }),
        round({ scope: ["vfx-this"] }),
      ],
      baseline: { scope: ["vfx-this", "reuse"], fee: null },
    });
    // The third round diffs against the first, not against the decline's [].
    expect(entries[2].removed).toEqual(["reuse"]);
    expect(entries[2].added).toEqual([]);
  });

  it("still diffs an accepted round, which does carry a real position", () => {
    const entries = buildRedline({
      rounds: [round({ action: "accepted", scope: ["vfx-this"], party: "producer" })],
      baseline: { scope: ["vfx-this", "reuse"], fee: null },
    });
    expect(entries[0].scopeStated).toBe(true);
    expect(entries[0].removed).toEqual(["reuse"]);
  });
});

describe("buildRedline — the null-fee trap", () => {
  it("reports an unstated fee as unstated, never as a change to zero", () => {
    const entries = buildRedline({
      rounds: [round({ scope: ["vfx-this"], fee: null })],
      baseline: { scope: ["vfx-this"], fee: 50_000 },
    });
    expect(entries[0].feeChanged).toBe(false);
    expect(entries[0].feeTo).toBeNull();
  });

  it("reports a real fee change with both sides", () => {
    const entries = buildRedline({
      rounds: [round({ scope: ["vfx-this"], fee: 75_000 })],
      baseline: { scope: ["vfx-this"], fee: 50_000 },
    });
    expect(entries[0].feeChanged).toBe(true);
    expect(entries[0].feeFrom).toBe(50_000);
    expect(entries[0].feeTo).toBe(75_000);
    expect(summariseRedline(entries[0])).toBe("fee revised");
  });

  it("carries the last stated fee forward across a round that states none", () => {
    const entries = buildRedline({
      rounds: [
        round({ scope: ["vfx-this"], fee: 50_000 }),
        round({ scope: ["vfx-this"], fee: null }),
        round({ scope: ["vfx-this"], fee: 90_000 }),
      ],
      baseline: { scope: ["vfx-this"], fee: null },
    });
    // The third round's change is measured against 50,000 — the last real
    // number — not against the null in between.
    expect(entries[2].feeFrom).toBe(50_000);
    expect(entries[2].feeTo).toBe(90_000);
    expect(entries[2].feeChanged).toBe(true);
  });

  it("does not report a change when only a baseline fee exists", () => {
    const entries = buildRedline({ rounds: [round({ scope: ["vfx-this"], fee: null })] });
    expect(entries[0].feeChanged).toBe(false);
  });
});

describe("summariseRedline", () => {
  it("counts additions and removals", () => {
    const entries = buildRedline({
      rounds: [round({ scope: ["reuse", "training"] })],
      baseline: { scope: ["vfx-this"], fee: null },
    });
    expect(summariseRedline(entries[0])).toBe("+2 · −1");
  });

  it("names the opening position rather than showing a delta", () => {
    const entries = buildRedline({ rounds: [round({ scope: USE_CATEGORIES.map((c) => c.id) })] });
    expect(summariseRedline(entries[0])).toBe(`Opening position — ${USE_CATEGORIES.length} uses`);
  });
});
