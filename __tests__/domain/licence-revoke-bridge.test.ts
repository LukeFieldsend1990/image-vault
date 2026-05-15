/**
 * Tests for the licence revoke → render-bridge purge flow.
 *
 * When a talent revokes an APPROVED licence:
 *  1. Licence moves to SCRUB_PERIOD with revokedAt + scrubDeadline set
 *  2. Dual-custody KV key is deleted
 *  3. All live bridgeGrants for that licence get purgeRequestedAt set
 *  4. All active render-bridge agents for the licence's org get pendingAction: "purge"
 *     (so on the next heartbeat the bridge receives action: "purge" and deletes local files)
 *
 * The project-grant endpoint already filters to APPROVED, non-expired licences,
 * so after revocation new file downloads via the bridge are immediately denied.
 */
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
vi.mock("@/lib/email/send", () => ({
  sendEmail: t.sendEmail,
}));

const { POST } = await import("@/app/api/licences/[id]/revoke/route");

const TALENT_ID = "talent-001";
const LICENCE_ID = "lic-001";
const ORG_ID = "org-001";

const approvedLicence = {
  id: LICENCE_ID,
  talentId: TALENT_ID,
  licenseeId: "licensee-001",
  status: "APPROVED",
  projectName: "The Movie",
  packageId: "pkg-001",
  organisationId: ORG_ID,
  productionId: null,
};

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/licences/:id/revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns 401 when the caller is unauthenticated", async () => {
    // No session set → requireSession returns 401
    const res = await POST(
      buildRequest(`/api/licences/${LICENCE_ID}/revoke`, { method: "POST" }),
      makeParams(LICENCE_ID)
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when a licensee tries to revoke (only talent/rep/admin allowed)", async () => {
    t.setSession({ sub: "lic-user", email: "licensee@prod.com", role: "licensee" });

    const res = await POST(
      buildRequest(`/api/licences/${LICENCE_ID}/revoke`, { method: "POST" }),
      makeParams(LICENCE_ID)
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 when the licence does not exist", async () => {
    t.setSession({ sub: TALENT_ID, email: "talent@test.com", role: "talent" });
    t.enqueue([]); // licence query returns empty

    const res = await POST(
      buildRequest(`/api/licences/${LICENCE_ID}/revoke`, { method: "POST" }),
      makeParams(LICENCE_ID)
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 when a talent tries to revoke another talent's licence", async () => {
    t.setSession({ sub: "other-talent", email: "other@test.com", role: "talent" });
    t.enqueue([{ ...approvedLicence, talentId: TALENT_ID }]); // owned by different talent

    const res = await POST(
      buildRequest(`/api/licences/${LICENCE_ID}/revoke`, { method: "POST" }),
      makeParams(LICENCE_ID)
    );
    expect(res.status).toBe(403);
  });

  it("returns 409 when the licence is not in APPROVED status", async () => {
    t.setSession({ sub: TALENT_ID, email: "talent@test.com", role: "talent" });
    t.enqueue([{ ...approvedLicence, status: "PENDING" }]);

    const res = await POST(
      buildRequest(`/api/licences/${LICENCE_ID}/revoke`, { method: "POST" }),
      makeParams(LICENCE_ID)
    );
    expect(res.status).toBe(409);
    const body = await parseJson(res);
    expect(body.error).toMatch(/APPROVED/);
  });

  it("returns 409 when the licence has no package attached", async () => {
    t.setSession({ sub: TALENT_ID, email: "talent@test.com", role: "talent" });
    t.enqueue([{ ...approvedLicence, packageId: null }]);

    const res = await POST(
      buildRequest(`/api/licences/${LICENCE_ID}/revoke`, { method: "POST" }),
      makeParams(LICENCE_ID)
    );
    expect(res.status).toBe(409);
  });

  it("sets licence status to SCRUB_PERIOD with revokedAt and scrubDeadline", async () => {
    t.setSession({ sub: TALENT_ID, email: "talent@test.com", role: "talent" });
    t.enqueue([approvedLicence]);

    const before = Math.floor(Date.now() / 1000);
    const res = await POST(
      buildRequest(`/api/licences/${LICENCE_ID}/revoke`, { method: "POST" }),
      makeParams(LICENCE_ID)
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.ok).toBe(true);
    expect(typeof body.scrubDeadline).toBe("number");

    const licenceUpdate = t.updatedRows[0]?.set as Record<string, unknown>;
    expect(licenceUpdate?.status).toBe("SCRUB_PERIOD");
    expect(licenceUpdate?.revokedAt).toBeGreaterThanOrEqual(before);
    // scrubDeadline = revokedAt + 14 days
    expect(licenceUpdate?.scrubDeadline).toBeGreaterThan(licenceUpdate?.revokedAt as number);
  });

  it("deletes the dual-custody KV key for the licence", async () => {
    t.setSession({ sub: TALENT_ID, email: "talent@test.com", role: "talent" });
    t.enqueue([approvedLicence]);

    await POST(
      buildRequest(`/api/licences/${LICENCE_ID}/revoke`, { method: "POST" }),
      makeParams(LICENCE_ID)
    );

    expect(t.kv.delete).toHaveBeenCalledWith(`dual_custody:${LICENCE_ID}`);
  });

  it("sets purgeRequestedAt on all live bridge grants for the licence", async () => {
    t.setSession({ sub: TALENT_ID, email: "talent@test.com", role: "talent" });
    t.enqueue([approvedLicence]);

    await POST(
      buildRequest(`/api/licences/${LICENCE_ID}/revoke`, { method: "POST" }),
      makeParams(LICENCE_ID)
    );

    // updatedRows[0] = licences, updatedRows[1] = bridgeGrants
    const grantUpdate = t.updatedRows[1]?.set as Record<string, unknown>;
    expect(typeof grantUpdate?.purgeRequestedAt).toBe("number");
  });

  it("signals all active render-bridge agents for the org to purge when organisationId is set", async () => {
    t.setSession({ sub: TALENT_ID, email: "talent@test.com", role: "talent" });
    t.enqueue([approvedLicence]); // licence has organisationId: ORG_ID

    await POST(
      buildRequest(`/api/licences/${LICENCE_ID}/revoke`, { method: "POST" }),
      makeParams(LICENCE_ID)
    );

    // updatedRows[0] = licences, updatedRows[1] = bridgeGrants, updatedRows[2] = renderBridgeAgents
    const agentUpdate = t.updatedRows[2]?.set as Record<string, unknown>;
    expect(agentUpdate?.pendingAction).toBe("purge");
  });

  it("does NOT signal render-bridge agents when the licence has no organisationId", async () => {
    t.setSession({ sub: TALENT_ID, email: "talent@test.com", role: "talent" });
    t.enqueue([{ ...approvedLicence, organisationId: null }]); // no org

    await POST(
      buildRequest(`/api/licences/${LICENCE_ID}/revoke`, { method: "POST" }),
      makeParams(LICENCE_ID)
    );

    // Only 2 updates: licences + bridgeGrants (no agent update)
    expect(t.updatedRows).toHaveLength(2);
  });

  it("admin can revoke any licence regardless of talentId", async () => {
    t.setSession({ sub: "admin-user", email: "admin@test.com", role: "admin" });
    t.enqueue([approvedLicence]); // owned by TALENT_ID, not admin

    const res = await POST(
      buildRequest(`/api/licences/${LICENCE_ID}/revoke`, { method: "POST" }),
      makeParams(LICENCE_ID)
    );
    expect(res.status).toBe(200);
  });
});

