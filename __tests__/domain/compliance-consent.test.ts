import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";

const t = createTestEnv();

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: t.getCloudflareContext }));
vi.mock("@/lib/db", () => ({ getDb: t.getDb, getKv: t.getKv }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: t.requireSession,
  isErrorResponse: t.isErrorResponse,
}));

const route = await import("@/app/api/compliance/consent/route");

const LICENCE = { talentId: "talent-1", licenseeId: "lic-1", organisationId: null };

// Find a recorded insert by a predicate on its values object.
const findInsert = (pred: (v: any) => boolean) =>
  t.insertedRows.map((r) => r.values as any).find(pred);

describe("POST /api/compliance/consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("401 without session", async () => {
    const res = await route.POST(buildRequest("/api/compliance/consent", { body: { licenceId: "L1", useType: "ai_avatar" } }));
    expect(res.status).toBe(401);
  });

  it("400 when licenceId or useType missing", async () => {
    t.setSession({ sub: "talent-1", email: "t@x.com", role: "talent" });
    const res = await route.POST(buildRequest("/api/compliance/consent", { body: { licenceId: "L1" } }));
    expect(res.status).toBe(400);
  });

  it("403 when a licensee tries to grant consent (write is talent/rep/admin only)", async () => {
    t.setSession({ sub: "lic-1", email: "l@x.com", role: "licensee" });
    t.enqueue({ complianceEnabled: true }); // isComplianceEnabled users lookup
    t.enqueue(LICENCE); // authorizeLicence licence lookup
    const res = await route.POST(buildRequest("/api/compliance/consent", { body: { licenceId: "L1", useType: "ai_avatar" } }));
    expect(res.status).toBe(403);
  });

  it("grants consent: appends a hash-chained consent.granted event + a granted projection row", async () => {
    t.setSession({ sub: "talent-1", email: "t@x.com", role: "talent" });
    t.enqueue({ complianceEnabled: true }); // isComplianceEnabled users lookup
    t.enqueue(LICENCE); // authorizeLicence
    t.enqueue(null);    // appendEvent tip (genesis)

    const res = await route.POST(buildRequest("/api/compliance/consent", { body: { licenceId: "L1", useType: "ai_avatar", territory: "worldwide" } }));
    expect(res.status).toBe(201);
    const json = await parseJson(res);
    expect(json.ok).toBe(true);
    expect(json.eventId).toBeTruthy();
    expect(json.recordId).toBeTruthy();

    const event = findInsert((v) => v.eventType === "consent.granted");
    expect(event).toBeTruthy();
    expect(event.clauseRef).toBe("39.B");
    expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(event.prevHash).toBe("licence:L1"); // genesis chains off the chain_key

    const record = findInsert((v) => v.status === "granted" && v.useType === "ai_avatar");
    expect(record).toBeTruthy();
    expect(record.territory).toBe("worldwide");
    expect(record.grantedEventId).toBe(event.id);
  });

  it("records a dub-language consent as a 39.D event when language is set", async () => {
    t.setSession({ sub: "talent-1", email: "t@x.com", role: "talent" });
    t.enqueue({ complianceEnabled: true }); // isComplianceEnabled users lookup
    t.enqueue(LICENCE);
    t.enqueue(null);

    const res = await route.POST(buildRequest("/api/compliance/consent", { body: { licenceId: "L1", useType: "dub", language: "fr" } }));
    expect(res.status).toBe(201);
    const event = findInsert((v) => v.eventType === "consent.dub_language_granted");
    expect(event).toBeTruthy();
    expect(event.clauseRef).toBe("39.D");
  });
});

describe("DELETE /api/compliance/consent (revoke)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("404 when the record does not exist", async () => {
    t.setSession({ sub: "talent-1", email: "t@x.com", role: "talent" });
    t.enqueue(undefined); // record lookup miss
    const res = await route.DELETE(buildRequest("/api/compliance/consent", { method: "DELETE", body: { recordId: "nope" } }));
    expect(res.status).toBe(404);
  });

  it("revokes: appends consent.revoked + flips the projection row to revoked", async () => {
    t.setSession({ sub: "talent-1", email: "t@x.com", role: "talent" });
    t.enqueue({ licenceId: "L1" });                          // route record lookup
    t.enqueue({ complianceEnabled: true });                   // isComplianceEnabled users lookup
    t.enqueue(LICENCE);                                       // authorizeLicence
    t.enqueue({ id: "rec-1", licenceId: "L1", talentId: "talent-1", useType: "ai_avatar", territory: null, language: null, status: "granted" }); // revokeConsent select
    t.enqueue(null);                                          // appendEvent tip

    const res = await route.DELETE(buildRequest("/api/compliance/consent", { method: "DELETE", body: { recordId: "rec-1" } }));
    expect(res.status).toBe(200);

    const event = findInsert((v) => v.eventType === "consent.revoked");
    expect(event).toBeTruthy();

    const update = t.updatedRows.map((r) => r.set as any).find((s) => s.status === "revoked");
    expect(update).toBeTruthy();
    expect(update.revokedEventId).toBe(event.id);
  });
});
