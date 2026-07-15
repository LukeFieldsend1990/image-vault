import { describe, it, expect } from "vitest";
import { latestTalentCounter, isThreadClosed, type NegotiationRound } from "@/lib/consent/negotiation";

function round(overrides: Partial<NegotiationRound> & Pick<NegotiationRound, "party" | "action">): NegotiationRound {
  return {
    id: crypto.randomUUID(),
    round: 1,
    scope: ["vfx-this"],
    fee: null,
    comment: null,
    createdAt: 1_700_000_000,
    ...overrides,
  };
}

describe("latestTalentCounter", () => {
  it("returns null for an empty thread", () => {
    expect(latestTalentCounter([])).toBeNull();
  });

  it("returns the most recent open talent counter", () => {
    const counter = round({ party: "talent", action: "counter", round: 1, scope: ["vfx-this", "reuse"] });
    expect(latestTalentCounter([counter])).toBe(counter);
  });

  it("returns a rep counter (reps negotiate on the talent's behalf)", () => {
    const counter = round({ party: "rep", action: "counter", round: 1 });
    expect(latestTalentCounter([counter])).toBe(counter);
  });

  it("a producer counter-back supersedes the talent's proposal", () => {
    const talentCounter = round({ party: "talent", action: "counter", round: 1 });
    const producerCounter = round({ party: "producer", action: "counter", round: 2, scope: ["vfx-this", "dub"] });
    expect(latestTalentCounter([talentCounter, producerCounter])).toBeNull();
  });

  it("a fresh talent counter after a producer counter-back is pending again", () => {
    const rounds = [
      round({ party: "talent", action: "counter", round: 1 }),
      round({ party: "producer", action: "counter", round: 2 }),
      round({ party: "talent", action: "counter", round: 3, scope: ["reuse"] }),
    ];
    expect(latestTalentCounter(rounds)).toBe(rounds[2]);
  });

  it("returns null once the thread is closed by acceptance or decline", () => {
    const counter = round({ party: "talent", action: "counter", round: 1 });
    const accepted = round({ party: "producer", action: "accepted", round: 2 });
    expect(latestTalentCounter([counter, accepted])).toBeNull();

    const declined = round({ party: "producer", action: "declined", round: 2 });
    expect(latestTalentCounter([counter, declined])).toBeNull();
  });
});

describe("isThreadClosed", () => {
  it("is false while counters are still flying", () => {
    expect(isThreadClosed([round({ party: "talent", action: "counter" })])).toBe(false);
  });

  it("is true once the last round accepted or declined", () => {
    expect(isThreadClosed([
      round({ party: "talent", action: "counter", round: 1 }),
      round({ party: "producer", action: "accepted", round: 2 }),
    ])).toBe(true);
  });
});
