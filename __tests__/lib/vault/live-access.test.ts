import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveLiveAccess } from "@/lib/vault/liveAccess";
import { createTestEnv } from "../../helpers/mocks";

const t = createTestEnv();

const NOW = Math.floor(Date.now() / 1000);
const HOUR = 3600;

function licence(over: Record<string, unknown> = {}) {
  return {
    id: "lic-1",
    shortCode: "LC-0001",
    projectName: "Ravensmoor",
    productionCompany: "Bellhouse Films",
    licenseeId: "user-9",
    status: "APPROVED",
    validFrom: NOW - 30 * 24 * HOUR,
    validTo: NOW + 30 * 24 * HOUR,
    revokedAt: null,
    deliveryMode: "standard",
    preauthUntil: null,
    permitAiTraining: false,
    ...over,
  };
}

function grant(over: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    licenceId: "lic-1",
    userId: "user-9",
    tool: "maya",
    deviceId: "device-1",
    expiresAt: NOW + 2 * HOUR,
    revokedAt: null,
    purgeRequestedAt: null,
    purgeCompletedAt: null,
    ...over,
  };
}

/** KV stub — the dual-custody session lives here, not in the database. */
function kvWith(sessions: Record<string, unknown> = {}) {
  return {
    get: async (key: string) => (key in sessions ? JSON.stringify(sessions[key]) : null),
  };
}

describe("resolveLiveAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns an empty result for a package with no licences", async () => {
    t.enqueue([]);
    const r = await resolveLiveAccess(t.db as never, kvWith(), "pkg-1");
    expect(r.licences).toEqual([]);
    expect(r.summary.liveGrants).toBe(0);
  });

  it("counts a live grant and names the device", async () => {
    t.enqueue([licence()]);
    t.enqueue([grant()]);
    t.enqueue([{ id: "user-9", email: "vfx@northlight.example" }]);
    t.enqueue([{ id: "user-9", email: "vfx@northlight.example" }]);
    t.enqueue([{ id: "device-1", displayName: "RENDER-04", lastSeenAt: NOW - 10 }]);

    const r = await resolveLiveAccess(t.db as never, kvWith(), "pkg-1");

    expect(r.summary.liveGrants).toBe(1);
    expect(r.licences[0].grants[0].deviceName).toBe("RENDER-04");
    expect(r.licences[0].grants[0].userEmail).toBe("vfx@northlight.example");
    expect(r.licences[0].openPaths).toBe(1);
    expect(r.licences[0].inForce).toBe(true);
  });

  it("drops an expired grant and a revoked grant", async () => {
    t.enqueue([licence()]);
    t.enqueue([
      grant({ id: "expired", deviceId: "device-a", expiresAt: NOW - 60 }),
      grant({ id: "revoked", deviceId: "device-b", revokedAt: NOW - 60 }),
    ]);
    t.enqueue([{ id: "user-9", email: "vfx@northlight.example" }]);
    t.enqueue([]);
    t.enqueue([]);

    const r = await resolveLiveAccess(t.db as never, kvWith(), "pkg-1");

    expect(r.summary.liveGrants).toBe(0);
    expect(r.licences[0].openPaths).toBe(0);
  });

  it("collapses repeat grants on the same device, so one bridge is not counted as many", async () => {
    // Reopening supersedes rather than adds; without the dedupe a single vendor
    // reopening three times would read as three vendors holding the scan.
    t.enqueue([licence()]);
    t.enqueue([
      grant({ id: "g1" }),
      grant({ id: "g2" }),
      grant({ id: "g3" }),
      grant({ id: "g4", deviceId: "device-2" }),
    ]);
    t.enqueue([{ id: "user-9", email: "vfx@northlight.example" }]);
    t.enqueue([{ id: "user-9", email: "vfx@northlight.example" }]);
    t.enqueue([]);

    const r = await resolveLiveAccess(t.db as never, kvWith(), "pkg-1");

    expect(r.summary.liveGrants).toBe(2);
  });

  it("counts an active pre-authorisation as an open path", async () => {
    t.enqueue([licence({ preauthUntil: NOW + HOUR })]);
    t.enqueue([]);
    t.enqueue([{ id: "user-9", email: "prod@bellhouse.example" }]);

    const r = await resolveLiveAccess(t.db as never, kvWith(), "pkg-1");

    expect(r.summary.activePreauths).toBe(1);
    expect(r.licences[0].preauthUntil).toBe(NOW + HOUR);
  });

  it("ignores a pre-authorisation on an AI-training licence, matching the download gate", async () => {
    t.enqueue([licence({ preauthUntil: NOW + HOUR, permitAiTraining: true })]);
    t.enqueue([]);
    t.enqueue([{ id: "user-9", email: "prod@bellhouse.example" }]);

    const r = await resolveLiveAccess(t.db as never, kvWith(), "pkg-1");

    expect(r.summary.activePreauths).toBe(0);
    expect(r.licences[0].preauthUntil).toBeNull();
  });

  it("ignores an expired pre-authorisation", async () => {
    t.enqueue([licence({ preauthUntil: NOW - 60 })]);
    t.enqueue([]);
    t.enqueue([{ id: "user-9", email: "prod@bellhouse.example" }]);

    const r = await resolveLiveAccess(t.db as never, kvWith(), "pkg-1");
    expect(r.summary.activePreauths).toBe(0);
  });

  it("surfaces an in-flight handshake and the tokens it has already issued", async () => {
    t.enqueue([licence()]);
    t.enqueue([]);
    t.enqueue([{ id: "user-9", email: "prod@bellhouse.example" }]);

    const r = await resolveLiveAccess(
      t.db as never,
      kvWith({
        "dual_custody:lic-1": {
          step: "awaiting_talent",
          expiresAt: NOW + 1800,
          downloadTokens: [{ token: "a" }, { token: "b" }],
        },
      }),
      "pkg-1",
    );

    expect(r.summary.openHandshakes).toBe(1);
    // Tokens outlive the 1h session by up to 48h, which is exactly why they
    // belong on a "right now" panel.
    expect(r.summary.outstandingTokens).toBe(2);
    expect(r.licences[0].handshake?.step).toBe("awaiting_talent");
  });

  it("survives a malformed session rather than taking the whole panel down", async () => {
    t.enqueue([licence()]);
    t.enqueue([grant()]);
    t.enqueue([{ id: "user-9", email: "vfx@northlight.example" }]);
    t.enqueue([{ id: "user-9", email: "vfx@northlight.example" }]);
    t.enqueue([{ id: "device-1", displayName: "RENDER-04", lastSeenAt: NOW - 10 }]);

    const kv = { get: async () => "{ not json" };
    const r = await resolveLiveAccess(t.db as never, kv, "pkg-1");

    expect(r.licences[0].handshake).toBeNull();
    expect(r.summary.liveGrants).toBe(1); // the more important half still reports
  });

  it("marks a revoked licence as not in force", async () => {
    t.enqueue([licence({ status: "REVOKED", revokedAt: NOW - HOUR })]);
    t.enqueue([]);
    t.enqueue([{ id: "user-9", email: "prod@bellhouse.example" }]);

    const r = await resolveLiveAccess(t.db as never, kvWith(), "pkg-1");
    expect(r.licences[0].inForce).toBe(false);
    expect(r.summary.licencesInForce).toBe(0);
  });
});
