import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";

const t = createTestEnv();

vi.mock("@cloudflare/next-on-pages", () => ({
  getRequestContext: t.getRequestContext,
}));
vi.mock("@/lib/db", () => ({
  getDb: t.getDb,
  getKv: t.getKv,
}));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: t.requireSession,
  isErrorResponse: t.isErrorResponse,
}));
vi.mock("@/lib/auth/repAccess", () => ({
  hasRepAccess: t.hasRepAccess,
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: t.sendEmail,
}));

const initiateRoute = await import("@/app/api/licences/[id]/download/initiate/route");
const licenseeTwoFaRoute = await import("@/app/api/licences/[id]/download/licensee-2fa/route");
const talentTwoFaRoute = await import("@/app/api/licences/[id]/download/talent-2fa/route");

const now = Math.floor(Date.now() / 1000);
const futureExpiry = now + 86400 * 30; // 30 days from now

describe("POST /api/licences/[id]/download/initiate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns 403 if caller is not a licensee", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    const res = await initiateRoute.POST(
      buildRequest("/api/licences/lic1/download/initiate", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent licence", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    t.enqueue([]); // licence not found
    const res = await initiateRoute.POST(
      buildRequest("/api/licences/lic1/download/initiate", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 if licensee is not the one on the licence", async () => {
    t.setSession({ sub: "l2", email: "other@test.com", role: "licensee" });
    t.enqueue([{
      id: "lic1", talentId: "t1", packageId: "p1", licenseeId: "l1",
      status: "APPROVED", validTo: futureExpiry, deliveryMode: "standard",
    }]);
    const res = await initiateRoute.POST(
      buildRequest("/api/licences/lic1/download/initiate", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 409 if licence is not APPROVED", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    t.enqueue([{
      id: "lic1", talentId: "t1", packageId: "p1", licenseeId: "l1",
      status: "PENDING", validTo: futureExpiry, deliveryMode: "standard",
    }]);
    const res = await initiateRoute.POST(
      buildRequest("/api/licences/lic1/download/initiate", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(409);
  });

  it("returns 409 if licence has expired", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    t.enqueue([{
      id: "lic1", talentId: "t1", packageId: "p1", licenseeId: "l1",
      status: "APPROVED", validTo: now - 86401, deliveryMode: "standard",
    }]);
    const res = await initiateRoute.POST(
      buildRequest("/api/licences/lic1/download/initiate", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(409);
    const body = await parseJson(res);
    expect(body.error).toContain("expired");
  });

  it("returns 423 if talent vault is locked", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    t.enqueue([{
      id: "lic1", talentId: "t1", packageId: "p1", licenseeId: "l1",
      status: "APPROVED", validTo: futureExpiry, deliveryMode: "standard",
    }]);
    // Talent vault check
    t.enqueue([{ vaultLocked: true }]);

    const res = await initiateRoute.POST(
      buildRequest("/api/licences/lic1/download/initiate", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(423);
  });

  it("returns 403 for bridge_only delivery mode", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    t.enqueue([{
      id: "lic1", talentId: "t1", packageId: "p1", licenseeId: "l1",
      status: "APPROVED", validTo: futureExpiry, deliveryMode: "bridge_only",
    }]);
    t.enqueue([{ vaultLocked: false }]);

    const res = await initiateRoute.POST(
      buildRequest("/api/licences/lic1/download/initiate", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(403);
    const body = await parseJson(res);
    expect(body.error).toContain("CAS Bridge");
  });

  it("creates dual-custody session in KV and returns awaiting_licensee", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    t.enqueue([{
      id: "lic1", talentId: "t1", packageId: "p1", licenseeId: "l1",
      status: "APPROVED", validTo: futureExpiry, deliveryMode: "standard",
    }]);
    t.enqueue([{ vaultLocked: false }]);

    const res = await initiateRoute.POST(
      buildRequest("/api/licences/lic1/download/initiate", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.step).toBe("awaiting_licensee");

    // Verify KV was populated
    expect(t.kv.put).toHaveBeenCalledWith(
      "dual_custody:lic1",
      expect.stringContaining("awaiting_licensee"),
      expect.objectContaining({ expirationTtl: 3600 })
    );
  });

  it("returns existing session state if one is active", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    t.enqueue([{
      id: "lic1", talentId: "t1", packageId: "p1", licenseeId: "l1",
      status: "APPROVED", validTo: futureExpiry, deliveryMode: "standard",
    }]);
    t.enqueue([{ vaultLocked: false }]);

    // Pre-populate an active session
    t.kv._store.set("dual_custody:lic1", JSON.stringify({
      step: "awaiting_talent",
      expiresAt: now + 3600,
    }));

    const res = await initiateRoute.POST(
      buildRequest("/api/licences/lic1/download/initiate", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    const body = await parseJson(res);
    expect(body.step).toBe("awaiting_talent");
  });
});

describe("POST /api/licences/[id]/download/licensee-2fa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns 403 if caller is not a licensee", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    const res = await licenseeTwoFaRoute.POST(
      buildRequest("/api/licences/lic1/download/licensee-2fa", { body: { code: "123456" } }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 409 when no active download session exists", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    const res = await licenseeTwoFaRoute.POST(
      buildRequest("/api/licences/lic1/download/licensee-2fa", { body: { code: "123456" } }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(409);
  });

  it("returns 400 when code is missing", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    const res = await licenseeTwoFaRoute.POST(
      buildRequest("/api/licences/lic1/download/licensee-2fa", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/licences/[id]/download/talent-2fa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns 403 if caller is a licensee", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    const res = await talentTwoFaRoute.POST(
      buildRequest("/api/licences/lic1/download/talent-2fa", { body: { code: "123456" } }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when code is missing", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    const res = await talentTwoFaRoute.POST(
      buildRequest("/api/licences/lic1/download/talent-2fa", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 when no active download session exists", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    const res = await talentTwoFaRoute.POST(
      buildRequest("/api/licences/lic1/download/talent-2fa", { body: { code: "123456" } }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(409);
  });
});
