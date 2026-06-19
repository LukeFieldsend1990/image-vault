/**
 * Tests for the production cast invitation lifecycle:
 *
 *  DELETE /api/productions/[id]/cast/[castId]
 *    — must REVOKE the associated licence so it vanishes from the
 *      talent's inbox (regression: was previously deleted with no
 *      licence cleanup, leaving dangling PENDING/AWAITING_PACKAGE rows)
 *
 *  POST /api/licences/[id]/accept-invite
 *    — AWAITING_PACKAGE → APPROVED without a package (talent will be
 *      scanned as part of the production)
 *
 *  PATCH /api/licences/[id]/attach-package
 *    — AWAITING_PACKAGE → PENDING (normal package-first path)
 *    — APPROVED → stays APPROVED, only packageId updated (post-accept path)
 *    — PENDING → stays PENDING, only packageId updated
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";

const t = createTestEnv();

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: t.getCloudflareContext,
}));
vi.mock("@/lib/db", () => ({ getDb: t.getDb, getKv: t.getKv }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: t.requireSession,
  isErrorResponse: t.isErrorResponse,
}));
vi.mock("@/lib/auth/adminEmails", () => ({ isAdmin: () => false }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/compliance/ledger", () => ({
  licenceChain: (id: string) => `chain:${id}`,
  appendEvent: vi.fn(async () => {}),
}));

const castRoute = await import("@/app/api/productions/[id]/cast/[castId]/route");
const acceptInviteRoute = await import("@/app/api/licences/[id]/accept-invite/route");
const attachPackageRoute = await import("@/app/api/licences/[id]/attach-package/route");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProduction(id = "prod1", organisationId = "org1") {
  return { id, organisationId };
}

function makeOrgMembership(memberRole = "owner") {
  return { memberRole };
}

function makeCastRow(overrides: Partial<{
  id: string; productionId: string; licenceId: string | null;
  inviteId: string | null; status: string;
}> = {}) {
  return {
    id: "cast1",
    productionId: "prod1",
    licenceId: "lic1",
    inviteId: null,
    status: "linked",
    ...overrides,
  };
}

function makeLicence(overrides: Partial<{
  id: string; talentId: string; licenseeId: string; status: string;
  packageId: string | null; projectName: string; proposedFee: number | null;
  licenceType: string; territory: string; validFrom: number; validTo: number;
}> = {}) {
  return {
    id: "lic1",
    talentId: "talent1",
    licenseeId: "licensee1",
    status: "AWAITING_PACKAGE",
    packageId: null,
    projectName: "Venom 4",
    proposedFee: 5000000,
    licenceType: "film_double",
    territory: "Worldwide",
    validFrom: 1700000000,
    validTo: 1800000000,
    ...overrides,
  };
}

function makePackage(overrides: Partial<{
  id: string; talentId: string; status: string; deletedAt: number | null; name: string;
}> = {}) {
  return {
    id: "pkg1",
    talentId: "talent1",
    status: "ready",
    deletedAt: null,
    name: "Full Body Scan",
    ...overrides,
  };
}

// ── DELETE cast member ────────────────────────────────────────────────────────

describe("DELETE /api/productions/[id]/cast/[castId]", () => {
  beforeEach(() => { vi.clearAllMocks(); t.reset(); });

  it("returns 401 without session", async () => {
    const res = await castRoute.DELETE(
      buildRequest("/api/productions/prod1/cast/cast1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "prod1", castId: "cast1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("revokes the linked licence when a cast member is removed", async () => {
    t.setSession({ sub: "licensee1", email: "lic@test.com", role: "licensee" });
    t.enqueue(makeProduction());            // load production
    t.enqueue(makeOrgMembership("owner"));  // org access check
    t.enqueue(makeCastRow());               // load cast row

    const res = await castRoute.DELETE(
      buildRequest("/api/productions/prod1/cast/cast1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "prod1", castId: "cast1" }) }
    );

    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.ok).toBe(true);

    const licenceUpdate = t.updatedRows.find(
      (r) => (r.set as Record<string, unknown>).status === "REVOKED"
    );
    expect(licenceUpdate).toBeDefined();
    expect((licenceUpdate!.set as Record<string, unknown>).revoked_at ?? (licenceUpdate!.set as Record<string, unknown>).revokedAt).toBeDefined();
  });

  it("does not attempt a licence update when cast row has no licenceId", async () => {
    t.setSession({ sub: "licensee1", email: "lic@test.com", role: "licensee" });
    t.enqueue(makeProduction());
    t.enqueue(makeOrgMembership("owner"));
    t.enqueue(makeCastRow({ licenceId: null, inviteId: "inv1", status: "invited" }));

    const res = await castRoute.DELETE(
      buildRequest("/api/productions/prod1/cast/cast1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "prod1", castId: "cast1" }) }
    );

    expect(res.status).toBe(200);
    const licenceRevoke = t.updatedRows.find(
      (r) => (r.set as Record<string, unknown>).status === "REVOKED"
    );
    expect(licenceRevoke).toBeUndefined();
  });

  it("allows removing a placeholder cast member (no licence/invite to clean up)", async () => {
    t.setSession({ sub: "licensee1", email: "lic@test.com", role: "licensee" });
    t.enqueue(makeProduction());
    t.enqueue(makeOrgMembership("owner"));
    t.enqueue(makeCastRow({ licenceId: null, inviteId: null, status: "placeholder" }));

    const res = await castRoute.DELETE(
      buildRequest("/api/productions/prod1/cast/cast1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "prod1", castId: "cast1" }) }
    );

    expect(res.status).toBe(200);
    const licenceRevoke = t.updatedRows.find(
      (r) => (r.set as Record<string, unknown>).status === "REVOKED"
    );
    expect(licenceRevoke).toBeUndefined();
  });

  it("returns 409 when trying to remove a consented cast member", async () => {
    t.setSession({ sub: "licensee1", email: "lic@test.com", role: "licensee" });
    t.enqueue(makeProduction());
    t.enqueue(makeOrgMembership("owner"));
    t.enqueue(makeCastRow({ status: "consented" }));

    const res = await castRoute.DELETE(
      buildRequest("/api/productions/prod1/cast/cast1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "prod1", castId: "cast1" }) }
    );

    expect(res.status).toBe(409);
  });

  it("returns 403 for non-owner org members", async () => {
    t.setSession({ sub: "member1", email: "member@test.com", role: "licensee" });
    t.enqueue(makeProduction());
    t.enqueue(makeOrgMembership("member")); // not owner/admin

    const res = await castRoute.DELETE(
      buildRequest("/api/productions/prod1/cast/cast1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "prod1", castId: "cast1" }) }
    );

    expect(res.status).toBe(403);
  });
});

// ── POST accept-invite ────────────────────────────────────────────────────────

describe("POST /api/licences/[id]/accept-invite", () => {
  beforeEach(() => { vi.clearAllMocks(); t.reset(); });

  it("returns 401 without session", async () => {
    const res = await acceptInviteRoute.POST(
      buildRequest("/api/licences/lic1/accept-invite"),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("transitions AWAITING_PACKAGE → APPROVED without requiring a package", async () => {
    t.setSession({ sub: "talent1", email: "talent@test.com", role: "talent" });
    t.enqueue([makeLicence()]);  // .limit(1).all() returns array

    const res = await acceptInviteRoute.POST(
      buildRequest("/api/licences/lic1/accept-invite"),
      { params: Promise.resolve({ id: "lic1" }) }
    );

    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.ok).toBe(true);

    const update = t.updatedRows.find(
      (r) => (r.set as Record<string, unknown>).status === "APPROVED"
    );
    expect(update).toBeDefined();
    // No packageId required — this is the key guardrail
    expect((update!.set as Record<string, unknown>).packageId).toBeUndefined();
  });

  it("returns 409 when licence is not in AWAITING_PACKAGE state", async () => {
    t.setSession({ sub: "talent1", email: "talent@test.com", role: "talent" });
    t.enqueue([makeLicence({ status: "PENDING" })]);

    const res = await acceptInviteRoute.POST(
      buildRequest("/api/licences/lic1/accept-invite"),
      { params: Promise.resolve({ id: "lic1" }) }
    );

    expect(res.status).toBe(409);
  });

  it("returns 403 when talent does not own the licence", async () => {
    t.setSession({ sub: "other-talent", email: "other@test.com", role: "talent" });
    t.enqueue([makeLicence({ talentId: "talent1" })]);

    const res = await acceptInviteRoute.POST(
      buildRequest("/api/licences/lic1/accept-invite"),
      { params: Promise.resolve({ id: "lic1" }) }
    );

    expect(res.status).toBe(403);
  });

  it("returns 403 for licensee role", async () => {
    t.setSession({ sub: "licensee1", email: "lic@test.com", role: "licensee" });

    const res = await acceptInviteRoute.POST(
      buildRequest("/api/licences/lic1/accept-invite"),
      { params: Promise.resolve({ id: "lic1" }) }
    );

    expect(res.status).toBe(403);
  });
});

// ── PATCH attach-package ──────────────────────────────────────────────────────

describe("PATCH /api/licences/[id]/attach-package", () => {
  beforeEach(() => { vi.clearAllMocks(); t.reset(); });

  it("returns 401 without session", async () => {
    const res = await attachPackageRoute.PATCH(
      buildRequest("/api/licences/lic1/attach-package", { method: "PATCH", body: { packageId: "pkg1" } }),
      { params: Promise.resolve({ id: "lic1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("AWAITING_PACKAGE + package → transitions to PENDING", async () => {
    t.setSession({ sub: "talent1", email: "talent@test.com", role: "talent" });
    t.enqueue([makeLicence({ status: "AWAITING_PACKAGE" })]);
    t.enqueue([makePackage()]);

    const res = await attachPackageRoute.PATCH(
      buildRequest("/api/licences/lic1/attach-package", { method: "PATCH", body: { packageId: "pkg1" } }),
      { params: Promise.resolve({ id: "lic1" }) }
    );

    expect(res.status).toBe(200);
    const statusUpdate = t.updatedRows.find(
      (r) => (r.set as Record<string, unknown>).status === "PENDING"
    );
    expect(statusUpdate).toBeDefined();
  });

  it("APPROVED + package → updates packageId, status stays APPROVED", async () => {
    t.setSession({ sub: "talent1", email: "talent@test.com", role: "talent" });
    t.enqueue([makeLicence({ status: "APPROVED" })]);
    t.enqueue([makePackage()]);

    const res = await attachPackageRoute.PATCH(
      buildRequest("/api/licences/lic1/attach-package", { method: "PATCH", body: { packageId: "pkg1" } }),
      { params: Promise.resolve({ id: "lic1" }) }
    );

    expect(res.status).toBe(200);
    // Should NOT set status to PENDING — talent already accepted
    const pendingUpdate = t.updatedRows.find(
      (r) => (r.set as Record<string, unknown>).status === "PENDING"
    );
    expect(pendingUpdate).toBeUndefined();
    // Should update packageId
    const pkgUpdate = t.updatedRows.find(
      (r) => (r.set as Record<string, unknown>).packageId === "pkg1"
    );
    expect(pkgUpdate).toBeDefined();
  });

  it("PENDING + package → updates packageId, status stays PENDING", async () => {
    t.setSession({ sub: "talent1", email: "talent@test.com", role: "talent" });
    t.enqueue([makeLicence({ status: "PENDING" })]);
    t.enqueue([makePackage()]);

    const res = await attachPackageRoute.PATCH(
      buildRequest("/api/licences/lic1/attach-package", { method: "PATCH", body: { packageId: "pkg1" } }),
      { params: Promise.resolve({ id: "lic1" }) }
    );

    expect(res.status).toBe(200);
    const approvedUpdate = t.updatedRows.find(
      (r) => (r.set as Record<string, unknown>).status === "APPROVED"
    );
    expect(approvedUpdate).toBeUndefined();
  });

  it("returns 409 when licence is in a terminal state (REVOKED)", async () => {
    t.setSession({ sub: "talent1", email: "talent@test.com", role: "talent" });
    t.enqueue([makeLicence({ status: "REVOKED" })]);

    const res = await attachPackageRoute.PATCH(
      buildRequest("/api/licences/lic1/attach-package", { method: "PATCH", body: { packageId: "pkg1" } }),
      { params: Promise.resolve({ id: "lic1" }) }
    );

    expect(res.status).toBe(409);
  });

  it("returns 409 when package does not belong to the licence's talent", async () => {
    t.setSession({ sub: "talent1", email: "talent@test.com", role: "talent" });
    t.enqueue([makeLicence({ status: "AWAITING_PACKAGE" })]);
    t.enqueue([makePackage({ talentId: "other-talent" })]);

    const res = await attachPackageRoute.PATCH(
      buildRequest("/api/licences/lic1/attach-package", { method: "PATCH", body: { packageId: "pkg1" } }),
      { params: Promise.resolve({ id: "lic1" }) }
    );

    expect(res.status).toBe(409);
  });

  it("returns 400 when packageId is missing from body", async () => {
    t.setSession({ sub: "talent1", email: "talent@test.com", role: "talent" });

    const res = await attachPackageRoute.PATCH(
      buildRequest("/api/licences/lic1/attach-package", { method: "PATCH", body: {} }),
      { params: Promise.resolve({ id: "lic1" }) }
    );

    expect(res.status).toBe(400);
  });
});
