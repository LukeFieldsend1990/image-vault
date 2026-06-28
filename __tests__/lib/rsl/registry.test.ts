import { describe, it, expect } from "vitest";
import { normalizeHumanConsentId, HUMAN_CONSENT_REGISTRY_URL } from "@/lib/rsl/registry";

describe("normalizeHumanConsentId", () => {
  it("accepts and trims plausible IDs", () => {
    expect(normalizeHumanConsentId("HCR-abc_123.4")).toBe("HCR-abc_123.4");
    expect(normalizeHumanConsentId("  abc123  ")).toBe("abc123");
  });
  it("rejects empties, wrong types, and out-of-charset / out-of-length input", () => {
    expect(normalizeHumanConsentId("")).toBeNull();
    expect(normalizeHumanConsentId("  ")).toBeNull();
    expect(normalizeHumanConsentId(null)).toBeNull();
    expect(normalizeHumanConsentId(123)).toBeNull();
    expect(normalizeHumanConsentId("ab")).toBeNull(); // too short
    expect(normalizeHumanConsentId("x".repeat(65))).toBeNull(); // too long
    expect(normalizeHumanConsentId("has spaces")).toBeNull();
    expect(normalizeHumanConsentId("bad/slash")).toBeNull();
  });
  it("points at the public registry", () => {
    expect(HUMAN_CONSENT_REGISTRY_URL).toContain("rslmedia.org");
  });
});
