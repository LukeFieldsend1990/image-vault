import { describe, it, expect } from "vitest";
import { buildOffer } from "@/lib/rsl/funnel";
import { normaliseClientKey } from "@/lib/rsl/licensee";
import type { RateCard } from "@/lib/rsl/rateCard";

const RC: RateCard = {
  id: "x", talentId: "t", useCategoryId: "training", unitType: "per_generation",
  unitRatePence: 250, upfrontFeePence: null, termDays: 365, autoAccept: true,
  currency: "USD", active: true, createdAt: 0, updatedAt: 0,
};

describe("buildOffer", () => {
  it("is unpriced with no rate card", () => {
    const o = buildOffer("ai-train", undefined);
    expect(o.priced).toBe(false);
    expect(o.unit_rate_cents).toBeNull();
    expect(o.currency).toBe("USD");
  });
  it("carries the rate card terms (cents) when priced", () => {
    const o = buildOffer("ai-train", RC);
    expect(o.priced).toBe(true);
    expect(o.unit_type).toBe("per_generation");
    expect(o.unit_rate_cents).toBe(250);
    expect(o.term_days).toBe(365);
  });
});

describe("normaliseClientKey", () => {
  it("prefers client_id, lowercased", () => {
    expect(normaliseClientKey("OpenAI-Bot", "x@y.com")).toBe("openai-bot");
  });
  it("falls back to contact email", () => {
    expect(normaliseClientKey(null, "Owner@Example.com")).toBe("owner@example.com");
    expect(normaliseClientKey("  ", "a@b.com")).toBe("a@b.com");
  });
  it("returns null when neither is present", () => {
    expect(normaliseClientKey(null, null)).toBeNull();
    expect(normaliseClientKey("", "")).toBeNull();
  });
});
