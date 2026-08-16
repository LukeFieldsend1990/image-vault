import { describe, it, expect } from "vitest";

import {
  captionSimilarity,
  handleVariants,
  reachOf,
  topByReach,
  scoreSiblingEvidence,
  selectSiblingTargets,
  type ReachAccount,
} from "@/lib/monitor/cross-platform";

function account(overrides: Partial<ReachAccount> = {}): ReachAccount {
  return {
    id: crypto.randomUUID(),
    platform: "instagram",
    handle: "ultimatestudiosofficial",
    cumulativeViews: 0,
    followerCount: null,
    ...overrides,
  };
}

describe("reachOf", () => {
  it("prefers views on flagged posts", () => {
    expect(reachOf({ cumulativeViews: 931_000, followerCount: 8_300 })).toBe(931_000);
  });

  it("falls back to a discounted follower count when nothing is flagged yet", () => {
    expect(reachOf({ cumulativeViews: 0, followerCount: 1_000_000 })).toBe(100_000);
    expect(reachOf({ cumulativeViews: 0, followerCount: null })).toBe(0);
  });
});

describe("topByReach", () => {
  const mk = (cumulativeViews: number) => ({ cumulativeViews, followerCount: null });

  it("takes a quarter of the list, biggest first", () => {
    const picked = topByReach([mk(10), mk(40), mk(20), mk(30)]);
    expect(picked.map((p) => p.cumulativeViews)).toEqual([40]);
  });

  it("always returns at least one account when any has reach", () => {
    expect(topByReach([mk(5)]).map((p) => p.cumulativeViews)).toEqual([5]);
  });

  it("ignores accounts with no reach at all", () => {
    expect(topByReach([mk(0), mk(0)])).toEqual([]);
    expect(topByReach([mk(0), mk(0), mk(100)]).map((p) => p.cumulativeViews)).toEqual([100]);
  });
});

describe("handleVariants", () => {
  it("keeps the handle and strips punctuation crossposters drop", () => {
    expect(handleVariants("reveal.aii")).toContain("reveal.aii");
    expect(handleVariants("reveal.aii")).toContain("revealaii");
    expect(handleVariants("@LeakingAI")[0]).toBe("leakingai");
  });

  it("drops spellings too short or too long to be handles", () => {
    expect(handleVariants("ai")).toEqual([]);
    expect(handleVariants("a".repeat(40))).toEqual([]);
  });
});

describe("selectSiblingTargets", () => {
  const accounts = [
    account({ id: "big", handle: "ultimatestudiosofficial", cumulativeViews: 900_000 }),
    account({ id: "mid", handle: "midaccount", cumulativeViews: 50_000 }),
    account({ id: "small-a", handle: "smalla", cumulativeViews: 900 }),
    account({ id: "small-b", handle: "smallb", cumulativeViews: 100 }),
  ];

  it("only probes the top quartile by reach", () => {
    const targets = selectSiblingTargets(accounts);
    expect(new Set(targets.map((t) => t.sourceAccountId))).toEqual(new Set(["big"]));
  });

  it("never probes the platform the account was found on", () => {
    const targets = selectSiblingTargets(accounts);
    expect(targets.every((t) => t.platform !== "instagram")).toBe(true);
    expect(new Set(targets.map((t) => t.platform))).toEqual(new Set(["tiktok", "youtube", "x"]));
  });

  it("skips a platform where that handle is already on the books", () => {
    const withSibling = [
      ...accounts,
      account({ id: "known", platform: "tiktok", handle: "ultimatestudiosofficial" }),
    ];
    const targets = selectSiblingTargets(withSibling);
    // Every spelling of this handle is already watched on TikTok, so there is
    // nothing left to pay to look up — the platform drops out entirely.
    expect(targets.some((t) => t.platform === "tiktok")).toBe(false);
    expect(targets.some((t) => t.platform === "x")).toBe(true);
  });

  it("still probes variant spellings when only the exact handle is known", () => {
    const withSibling = [
      ...accounts,
      account({ id: "dotted", handle: "reveal.aii", cumulativeViews: 800_000 }),
      account({ id: "known", platform: "tiktok", handle: "reveal.aii" }),
    ];
    const tiktok = selectSiblingTargets(withSibling).find(
      (t) => t.platform === "tiktok" && t.sourceAccountId === "dotted"
    );
    expect(tiktok?.candidates).not.toContain("reveal.aii");
    expect(tiktok?.candidates).toContain("revealaii");
  });

  it("returns nothing when no account has any reach", () => {
    expect(selectSiblingTargets([account({ cumulativeViews: 0, followerCount: 0 })])).toEqual([]);
  });
});

describe("captionSimilarity", () => {
  it("scores a republished caption as a match", () => {
    const a = "Venom 4 first look — full trailer breakdown #tomhardy #venom4 #concept";
    const b = "Venom 4 first look — full trailer breakdown #tomhardy #venom4";
    expect(captionSimilarity(a, b)).toBeGreaterThan(0.5);
  });

  it("does not match unrelated posts that merely share a handle", () => {
    const a = "Venom 4 first look — full trailer breakdown #tomhardy #venom4";
    const b = "new drop this friday, link in bio";
    expect(captionSimilarity(a, b)).toBeLessThan(0.2);
  });

  it("is zero when either side has no caption", () => {
    expect(captionSimilarity(null, "anything at all here")).toBe(0);
    expect(captionSimilarity("anything at all here", "")).toBe(0);
  });
});

describe("scoreSiblingEvidence", () => {
  const sourceCaptions = [
    "Venom 4 first look — full trailer breakdown #tomhardy #venom4 #concept",
    "Bane returns, generated sequence #tomhardy",
  ];

  it("confirms when posts republish flagged captions", () => {
    const evidence = scoreSiblingEvidence(sourceCaptions, [
      { url: "https://tiktok.com/@x/video/1", caption: "Venom 4 first look — full trailer breakdown #tomhardy #venom4" },
      { url: "https://tiktok.com/@x/video/2", caption: "unrelated cooking video" },
    ]);
    expect(evidence.matchedPosts).toBe(1);
    expect(evidence.bestSimilarity).toBeGreaterThan(0.5);
    expect(evidence.examples).toEqual(["https://tiktok.com/@x/video/1"]);
  });

  it("stays a name-only lead when nothing matches", () => {
    const evidence = scoreSiblingEvidence(sourceCaptions, [
      { url: "https://tiktok.com/@x/video/3", caption: "my morning routine" },
    ]);
    expect(evidence.matchedPosts).toBe(0);
    expect(evidence.examples).toEqual([]);
  });

  it("handles an account with no posts to compare", () => {
    expect(scoreSiblingEvidence(sourceCaptions, [])).toEqual({
      matchedPosts: 0,
      bestSimilarity: 0,
      examples: [],
    });
  });
});
