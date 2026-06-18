import { describe, it, expect } from "vitest";
import { isInsurerAlertBridgeEvent } from "@/lib/notifications/insurer";

describe("isInsurerAlertBridgeEvent", () => {
  it("alerts on any critical-severity event regardless of type", () => {
    expect(isInsurerAlertBridgeEvent("cache_purged", "critical")).toBe(true);
    expect(isInsurerAlertBridgeEvent("lease_expired", "critical")).toBe(true);
  });

  it("alerts on integrity-failure event types even at warn severity", () => {
    expect(isInsurerAlertBridgeEvent("tamper_detected", "warn")).toBe(true);
    expect(isInsurerAlertBridgeEvent("unexpected_copy", "warn")).toBe(true);
    expect(isInsurerAlertBridgeEvent("hash_mismatch", "warn")).toBe(true);
    expect(isInsurerAlertBridgeEvent("re_access_denied", "warn")).toBe(true);
  });

  it("stays quiet for routine lifecycle events at non-critical severity", () => {
    expect(isInsurerAlertBridgeEvent("cache_purged", "info")).toBe(false);
    expect(isInsurerAlertBridgeEvent("lease_expired", "warn")).toBe(false);
    expect(isInsurerAlertBridgeEvent("open_denied", "warn")).toBe(false);
  });
});
