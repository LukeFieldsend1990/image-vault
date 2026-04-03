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

const licencesRoute = await import("@/app/api/licences/route");
const approveRoute = await import("@/app/api/licences/[id]/approve/route");
const denyRoute = await import("@/app/api/licences/[id]/deny/route");
const revokeRoute = await import("@/app/api/licences/[id]/revoke/route");

describe("POST /api/licences (create licence request)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns 401 without session", async () => {
    const res = await licencesRoute.POST(
      buildRequest("/api/licences", { body: {} })
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 if caller is not a licensee", async () => {
    t.setSession({ sub: "u1", email: "talent@test.com", role: "talent" });
    const res = await licencesRoute.POST(
      buildRequest("/api/licences", {
        body: { packageId: "p1", projectName: "Film", productionCompany: "Co", intendedUse: "VFX", validFrom: 1, validTo: 2 },
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for missing required fields", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    const res = await licencesRoute.POST(
      buildRequest("/api/licences", { body: { packageId: "p1" } })
    );
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body.error).toContain("Missing");
  });

  it("returns 404 if package not found or not ready", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    // Package query returns uploading status
    t.enqueue([{ id: "p1", talentId: "t1", status: "uploading" }]);

    const res = await licencesRoute.POST(
      buildRequest("/api/licences", {
        body: {
          packageId: "p1",
          projectName: "Film",
          productionCompany: "Studio",
          intendedUse: "VFX double",
          validFrom: 1700000000,
          validTo: 1710000000,
        },
      })
    );
    expect(res.status).toBe(404);
  });

  it("returns 423 if talent vault is locked", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    // Package exists and is ready
    t.enqueue([{ id: "p1", talentId: "t1", status: "ready" }]);
    // Talent user has vault locked
    t.enqueue([{ vaultLocked: true }]);

    const res = await licencesRoute.POST(
      buildRequest("/api/licences", {
        body: {
          packageId: "p1",
          projectName: "Film",
          productionCompany: "Studio",
          intendedUse: "VFX double",
          validFrom: 1700000000,
          validTo: 1710000000,
        },
      })
    );
    expect(res.status).toBe(423);
  });

  it("returns 201 on success with licenceId", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    // Package ready
    t.enqueue([{ id: "p1", talentId: "t1", status: "ready" }]);
    // Talent vault not locked
    t.enqueue([{ vaultLocked: false }]);

    const res = await licencesRoute.POST(
      buildRequest("/api/licences", {
        body: {
          packageId: "p1",
          projectName: "Film X",
          productionCompany: "Big Studio",
          intendedUse: "Character double",
          validFrom: 1700000000,
          validTo: 1710000000,
          proposedFee: 50000,
        },
      })
    );
    expect(res.status).toBe(201);
    const body = await parseJson(res);
    expect(body.licenceId).toBeDefined();
    // Should have inserted a licence
    expect(t.insertedRows.length).toBeGreaterThan(0);
  });
});

describe("POST /api/licences/[id]/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns 403 if caller is a licensee", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });
    const res = await approveRoute.POST(
      buildRequest("/api/licences/lic1/approve", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent licence", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    t.enqueue([]); // licence not found
    const res = await approveRoute.POST(
      buildRequest("/api/licences/lic1/approve", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 if licence is not PENDING", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    t.enqueue([{
      id: "lic1", talentId: "t1", licenseeId: "l1", status: "APPROVED",
      projectName: "F", packageId: "p1", validFrom: 1, validTo: 2, proposedFee: null,
    }]);
    const res = await approveRoute.POST(
      buildRequest("/api/licences/lic1/approve", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(409);
  });

  it("returns 403 if talent does not own the licence", async () => {
    t.setSession({ sub: "t2", email: "other@test.com", role: "talent" });
    t.enqueue([{
      id: "lic1", talentId: "t1", licenseeId: "l1", status: "PENDING",
      projectName: "F", packageId: "p1", validFrom: 1, validTo: 2, proposedFee: 1000,
    }]);
    const res = await approveRoute.POST(
      buildRequest("/api/licences/lic1/approve", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("approves successfully and calculates 15% platform fee", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    t.enqueue([{
      id: "lic1", talentId: "t1", licenseeId: "l1", status: "PENDING",
      projectName: "Film", packageId: "p1", validFrom: 1, validTo: 2, proposedFee: 10000,
    }]);

    const res = await approveRoute.POST(
      buildRequest("/api/licences/lic1/approve", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.ok).toBe(true);

    // Verify the update included the fee calculation
    expect(t.updatedRows.length).toBeGreaterThan(0);
    const update = t.updatedRows[0].set as any;
    expect(update.status).toBe("APPROVED");
    expect(update.agreedFee).toBe(10000);
    expect(update.platformFee).toBe(1500); // 15% of 10000
  });

  it("admin can approve any licence", async () => {
    t.setSession({ sub: "admin1", email: "admin@test.com", role: "admin" });
    t.enqueue([{
      id: "lic1", talentId: "t1", licenseeId: "l1", status: "PENDING",
      projectName: "Film", packageId: "p1", validFrom: 1, validTo: 2, proposedFee: null,
    }]);

    const res = await approveRoute.POST(
      buildRequest("/api/licences/lic1/approve", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/licences/[id]/deny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("denies a pending licence with reason", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    t.enqueue([{
      id: "lic1", talentId: "t1", licenseeId: "l1", status: "PENDING",
      projectName: "Film", packageId: "p1",
    }]);

    const res = await denyRoute.POST(
      buildRequest("/api/licences/lic1/deny", { body: { reason: "Not suitable" } }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(200);

    const update = t.updatedRows[0].set as any;
    expect(update.status).toBe("DENIED");
    expect(update.deniedReason).toBe("Not suitable");
  });

  it("returns 409 if licence is not PENDING", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    t.enqueue([{
      id: "lic1", talentId: "t1", licenseeId: "l1", status: "APPROVED",
      projectName: "Film", packageId: "p1",
    }]);

    const res = await denyRoute.POST(
      buildRequest("/api/licences/lic1/deny", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /api/licences/[id]/revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("revokes an approved licence and kills dual-custody session", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    t.enqueue([{
      id: "lic1", talentId: "t1", licenseeId: "l1", status: "APPROVED",
      projectName: "Film", packageId: "p1",
    }]);

    // Pre-populate a dual custody session
    t.kv._store.set("dual_custody:lic1", JSON.stringify({ step: "awaiting_talent" }));

    const res = await revokeRoute.POST(
      buildRequest("/api/licences/lic1/revoke", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(200);

    const update = t.updatedRows[0].set as any;
    expect(update.status).toBe("REVOKED");
    // KV dual custody session should be deleted
    expect(t.kv.delete).toHaveBeenCalledWith("dual_custody:lic1");
  });

  it("returns 409 if licence is not APPROVED", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    t.enqueue([{
      id: "lic1", talentId: "t1", licenseeId: "l1", status: "PENDING",
      projectName: "Film", packageId: "p1",
    }]);

    const res = await revokeRoute.POST(
      buildRequest("/api/licences/lic1/revoke", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(409);
  });

  it("returns 403 if talent is not the owner", async () => {
    t.setSession({ sub: "t2", email: "other@test.com", role: "talent" });
    t.enqueue([{
      id: "lic1", talentId: "t1", licenseeId: "l1", status: "APPROVED",
      projectName: "Film", packageId: "p1",
    }]);

    const res = await revokeRoute.POST(
      buildRequest("/api/licences/lic1/revoke", { body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(403);
  });
});
