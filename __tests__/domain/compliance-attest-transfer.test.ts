import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";

const t = createTestEnv();

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: t.getCloudflareContext }));
vi.mock("@/lib/db", () => ({ getDb: t.getDb, getKv: t.getKv }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: t.requireSession,
  isErrorResponse: t.isErrorResponse,
}));

const attestRoute = await import("@/app/api/compliance/attestations/route");
const transferRoute = await import("@/app/api/compliance/transfers/route");
const transferIdRoute = await import("@/app/api/compliance/transfers/[id]/route");
const reasonRoute = await import("@/app/api/compliance/business-reason/route");

const LICENCE = { talentId: "talent-1", licenseeId: "lic-1", organisationId: "org-1" };
const LICENSEE = { sub: "lic-1", email: "l@x.com", role: "licensee" as const };
const TALENT = { sub: "talent-1", email: "t@x.com", role: "talent" as const };
const ADMIN = { sub: "admin-1", email: "lukefieldsend@googlemail.com", role: "admin" as const };

const values = () => t.insertedRows.map((r) => r.values as any);
const findEvent = (type: string) => values().find((v) => v.eventType === type);

describe("attestations (39.E / 39.H)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("403 when a talent tries to attest (producer/admin only)", async () => {
    t.setSession(TALENT);
    t.enqueue({ complianceEnabled: true }); // isComplianceEnabled users lookup
    t.enqueue(LICENCE);
    const res = await attestRoute.POST(buildRequest("/api/compliance/attestations", { body: { licenceId: "L1", attestationType: "security_custody", attestationText: "we secure it" } }));
    expect(res.status).toBe(403);
  });

  it("400 on an unknown attestation type", async () => {
    t.setSession(LICENSEE);
    const res = await attestRoute.POST(buildRequest("/api/compliance/attestations", { body: { licenceId: "L1", attestationType: "bogus", attestationText: "x" } }));
    expect(res.status).toBe(400);
  });

  it("records a biometric-isolation attestation + 39.E event", async () => {
    t.setSession(LICENSEE);
    t.enqueue({ complianceEnabled: true }); // isComplianceEnabled users lookup
    t.enqueue(LICENCE); // authorizeProducer
    t.enqueue(null); // appendEvent tip
    const res = await attestRoute.POST(buildRequest("/api/compliance/attestations", { body: { licenceId: "L1", attestationType: "biometric_isolation", attestationText: "biometrics stay in the vault" } }));
    expect(res.status).toBe(201);
    expect(findEvent("biometric.isolation_attested").clauseRef).toBe("39.E");
    expect(values().find((v) => v.attestationType === "biometric_isolation")).toBeTruthy();
  });
});

describe("transfers (39.I)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("producer requests a transfer → requested row + transfer.requested event", async () => {
    t.setSession(LICENSEE);
    t.enqueue({ complianceEnabled: true }); // isComplianceEnabled users lookup
    t.enqueue(LICENCE); // authorizeProducer
    t.enqueue(null); // appendEvent tip
    const res = await transferRoute.POST(buildRequest("/api/compliance/transfers", { body: { licenceId: "L1", toPartyName: "Third Party VFX" } }));
    expect(res.status).toBe(201);
    expect(values().find((v) => v.status === "requested" && v.toPartyName === "Third Party VFX")).toBeTruthy();
    expect(findEvent("transfer.requested").clauseRef).toBe("39.I");
  });

  it("403 when a non-admin tries to decide a transfer", async () => {
    t.setSession(LICENSEE);
    const res = await transferIdRoute.PATCH(buildRequest("/api/compliance/transfers/tr1", { method: "PATCH", body: { decision: "approved" } }), { params: Promise.resolve({ id: "tr1" }) });
    expect(res.status).toBe(403);
  });

  it("admin approves a transfer (Union-approved) → approved + transfer.approved event", async () => {
    t.setSession(ADMIN);
    t.enqueue({ id: "tr1", licenceId: "L1", status: "requested" }); // decideTransfer select
    t.enqueue(null); // appendEvent tip
    const res = await transferIdRoute.PATCH(buildRequest("/api/compliance/transfers/tr1", { method: "PATCH", body: { decision: "approved", unionApproved: true } }), { params: Promise.resolve({ id: "tr1" }) });
    expect(res.status).toBe(200);
    expect((await parseJson(res)).status).toBe("approved");
    const update = t.updatedRows.map((r) => r.set as any).find((s) => s.status === "approved");
    expect(update.unionApproved).toBe(true);
    expect(findEvent("transfer.approved")).toBeTruthy();
  });

  it("409 when deciding a transfer that no longer exists / is decided", async () => {
    t.setSession(ADMIN);
    t.enqueue(undefined);
    const res = await transferIdRoute.PATCH(buildRequest("/api/compliance/transfers/tr1", { method: "PATCH", body: { decision: "denied" } }), { params: Promise.resolve({ id: "tr1" }) });
    expect(res.status).toBe(409);
  });
});

describe("business reason (39.J) + training notice (39.L)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("records a 39.J business reason", async () => {
    t.setSession(LICENSEE);
    t.enqueue({ complianceEnabled: true }); // isComplianceEnabled users lookup
    t.enqueue(LICENCE);
    t.enqueue(null);
    const res = await reasonRoute.POST(buildRequest("/api/compliance/business-reason", { body: { licenceId: "L1", reason: "stunt double for action sequence" } }));
    expect(res.status).toBe(201);
    expect((await parseJson(res)).clause).toBe("39.J");
    expect(findEvent("business_reason.recorded")).toBeTruthy();
  });

  it("files a 39.L training notice when trainingNotice is set", async () => {
    t.setSession(LICENSEE);
    t.enqueue({ complianceEnabled: true }); // isComplianceEnabled users lookup
    t.enqueue(LICENCE);
    t.enqueue(null);
    const res = await reasonRoute.POST(buildRequest("/api/compliance/business-reason", { body: { licenceId: "L1", trainingNotice: true } }));
    expect(res.status).toBe(201);
    expect((await parseJson(res)).clause).toBe("39.L");
    expect(findEvent("training.notice_filed")).toBeTruthy();
  });
});
