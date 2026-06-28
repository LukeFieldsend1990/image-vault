import { describe, it, expect } from "vitest";
import { postureFromMap, RSL_USAGE_MAP } from "@/lib/rsl/posture";
import { decideForUsage, parseResourceToSlug, USAGE_TO_CATEGORY, SUPPORTED_USAGES } from "@/lib/rsl/olp";

describe("RSL posture derivation", () => {
  it("defaults every category to red (prohibited) when nothing is set", () => {
    const p = postureFromMap({});
    expect(p.overall).toBe("red");
    for (const c of p.categories) expect(c.light).toBe("red");
  });

  it("maps dispositions to the stoplight", () => {
    const p = postureFromMap({ training: "always", replica: "never" });
    const training = p.categories.find((c) => c.id === "training")!;
    const replica = p.categories.find((c) => c.id === "replica")!;
    expect(training.light).toBe("green");
    expect(replica.light).toBe("red");
    // mixed live categories → amber headline
    expect(p.overall).toBe("amber");
  });

  it("is green overall only when every live category is green", () => {
    expect(postureFromMap({ training: "always", replica: "always" }).overall).toBe("green");
  });

  it("only the two AI categories carry a live RSL usage token", () => {
    expect(RSL_USAGE_MAP.training).toBe("ai-train");
    expect(RSL_USAGE_MAP.replica).toBe("ai-use");
    expect(RSL_USAGE_MAP.dub).toBeNull();
    expect(RSL_USAGE_MAP.marketing).toBeNull();
  });
});

describe("OLP usage mapping + decisions", () => {
  it("exposes exactly the two supported usages", () => {
    expect(SUPPORTED_USAGES.sort()).toEqual(["ai-train", "ai-use"]);
    expect(USAGE_TO_CATEGORY["ai-train"]).toBe("training");
    expect(USAGE_TO_CATEGORY["ai-use"]).toBe("replica");
  });

  it("denies a red usage, auto-grants green, routes amber to review", () => {
    const p = postureFromMap({ training: "always", replica: "case_by_case" });
    expect(decideForUsage(p, "ai-train")).toEqual({ kind: "auto_grant", categoryId: "training" });
    expect(decideForUsage(p, "ai-use")).toEqual({ kind: "review", categoryId: "replica" });
    // unset category → red → denied
    const bare = postureFromMap({});
    expect(decideForUsage(bare, "ai-train").kind).toBe("denied");
  });

  it("rejects unknown usages as invalid", () => {
    expect(decideForUsage(postureFromMap({}), "ai-everything").kind).toBe("invalid");
  });
});

describe("parseResourceToSlug", () => {
  it("accepts a bare slug", () => {
    expect(parseResourceToSlug("abc123")).toBe("abc123");
  });
  it("extracts from a /c/<slug> consent URL", () => {
    expect(parseResourceToSlug("https://changling.io/c/abc123")).toBe("abc123");
    expect(parseResourceToSlug("https://changling.io/c/abc123?x=1")).toBe("abc123");
  });
  it("extracts from a license.xml URL", () => {
    expect(parseResourceToSlug("https://changling.io/api/rsl/abc123/license.xml")).toBe("abc123");
  });
  it("returns null for unrelated URLs and empties", () => {
    expect(parseResourceToSlug("https://changling.io/dashboard")).toBeNull();
    expect(parseResourceToSlug("")).toBeNull();
    expect(parseResourceToSlug(null)).toBeNull();
  });
});
