import { describe, it, expect } from "vitest";
import {
  computePurgeGrace,
  formatGraceRemaining,
  OFFLINE_GRACE_SECS,
  ONLINE_THRESHOLD_SECS,
} from "@/lib/bridge/purgeGrace";

const NOW = 1_000_000;
const base = { revoked: false, pendingAction: null as string | null, now: NOW };

describe("computePurgeGrace", () => {
  it("reports online while the heartbeat is within the threshold", () => {
    const s = computePurgeGrace({ ...base, lastHeartbeatAt: NOW - (ONLINE_THRESHOLD_SECS - 1) });
    expect(s.kind).toBe("online");
  });

  it("counts down once offline, anchored on lastHeartbeat + 48h", () => {
    const lastHeartbeatAt = NOW - 2 * 3600; // 2h ago
    const s = computePurgeGrace({ ...base, lastHeartbeatAt });
    expect(s.kind).toBe("counting");
    if (s.kind !== "counting") return;
    expect(s.deadlineUnix).toBe(lastHeartbeatAt + OFFLINE_GRACE_SECS);
    expect(s.secondsRemaining).toBe(OFFLINE_GRACE_SECS - 2 * 3600);
  });

  it("flips to elapsed once past the 48h window", () => {
    const s = computePurgeGrace({ ...base, lastHeartbeatAt: NOW - 49 * 3600 });
    expect(s.kind).toBe("elapsed");
  });

  it("treats exactly 48h offline as elapsed (boundary)", () => {
    const s = computePurgeGrace({ ...base, lastHeartbeatAt: NOW - OFFLINE_GRACE_SECS });
    expect(s.kind).toBe("elapsed");
  });

  // Suppression rules: the bridge purges *immediately* in these states, so no
  // 48h countdown should ever be shown.
  it("suppresses the countdown for a revoked agent", () => {
    const s = computePurgeGrace({ ...base, lastHeartbeatAt: NOW - 2 * 3600, revoked: true });
    expect(s.kind).toBe("none");
  });

  it("suppresses the countdown when a server purge is pending", () => {
    const s = computePurgeGrace({ ...base, lastHeartbeatAt: NOW - 2 * 3600, pendingAction: "purge" });
    expect(s.kind).toBe("none");
  });

  it("suppresses the countdown for an agent that never heart-beat", () => {
    const s = computePurgeGrace({ ...base, lastHeartbeatAt: null });
    expect(s.kind).toBe("none");
  });

  it("does not suppress for non-purge pending actions (e.g. publish)", () => {
    const s = computePurgeGrace({ ...base, lastHeartbeatAt: NOW - 2 * 3600, pendingAction: "publish" });
    expect(s.kind).toBe("counting");
  });
});

describe("formatGraceRemaining", () => {
  it("renders days and hours past 24h", () => {
    expect(formatGraceRemaining(47 * 3600)).toBe("1d 23h");
  });

  it("renders hours and minutes under a day", () => {
    expect(formatGraceRemaining(2 * 3600 + 30 * 60)).toBe("2h 30m");
  });

  it("renders minutes under an hour", () => {
    expect(formatGraceRemaining(15 * 60)).toBe("15m");
  });

  it("floors anything under a minute to '< 1m' and never goes negative", () => {
    expect(formatGraceRemaining(30)).toBe("< 1m");
    expect(formatGraceRemaining(-100)).toBe("< 1m");
  });
});
