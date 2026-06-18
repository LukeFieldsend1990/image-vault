import { describe, it, expect } from "vitest";
import { detectUseViolation, isViolation } from "@/lib/compliance/violations";

// Minimal event shape the detector reads (eventType + createdAt).
const ev = (eventType: string, createdAt: number) => ({ eventType, createdAt });

describe("detectUseViolation", () => {
  it("returns none when the likeness was never used", () => {
    const v = detectUseViolation({ lastDownloadAt: null }, [ev("consent.granted", 100)]);
    expect(v.kind).toBe("none");
    expect(v.firstUseAt).toBeNull();
  });

  it("returns none when consent precedes the first use", () => {
    const v = detectUseViolation({ lastDownloadAt: 200 }, [ev("consent.granted", 100)]);
    expect(v.kind).toBe("none");
    expect(v.firstConsentAt).toBe(100);
    expect(v.firstUseAt).toBe(200);
  });

  it("flags used_without_consent when a download exists but no consent is recorded", () => {
    const v = detectUseViolation({ lastDownloadAt: 200 }, []);
    expect(v.kind).toBe("used_without_consent");
    expect(v.firstConsentAt).toBeNull();
    expect(isViolation(v.kind)).toBe(true);
  });

  it("flags used_before_consent when a download predates consent", () => {
    const v = detectUseViolation({ lastDownloadAt: 50 }, [ev("consent.granted", 100)]);
    expect(v.kind).toBe("used_before_consent");
    expect(v.gapSeconds).toBe(50);
    expect(isViolation(v.kind)).toBe(true);
  });

  it("uses the earliest metered-use event, not just lastDownloadAt", () => {
    // lastDownloadAt (the LAST download) is after consent, but an earlier metered
    // use proves the likeness was exercised before consent existed.
    const v = detectUseViolation({ lastDownloadAt: 300 }, [
      ev("use.metered", 40),
      ev("consent.granted", 100),
    ]);
    expect(v.kind).toBe("used_before_consent");
    expect(v.firstUseAt).toBe(40);
  });

  it("treats a dub-language consent as satisfying base consent", () => {
    const v = detectUseViolation({ lastDownloadAt: 200 }, [ev("consent.dub_language_granted", 100)]);
    expect(v.kind).toBe("none");
    expect(v.firstConsentAt).toBe(100);
  });

  it("does not flag when a download happens after a back-filled consent's first grant", () => {
    // Two grants; the earliest is what matters. Download at 150 > earliest consent 100 → clean.
    const v = detectUseViolation({ lastDownloadAt: 150 }, [
      ev("consent.granted", 100),
      ev("consent.granted", 300),
    ]);
    expect(v.kind).toBe("none");
    expect(v.firstConsentAt).toBe(100);
  });
});
