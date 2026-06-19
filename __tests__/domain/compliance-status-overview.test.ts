import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";
import { hashEvent } from "@/lib/compliance/ledger";

const t = createTestEnv();

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: t.getCloudflareContext }));
vi.mock("@/lib/db", () => ({ getDb: t.getDb, getKv: t.getKv }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: t.requireSession,
  isErrorResponse: t.isErrorResponse,
}));

const statusRoute = await import("@/app/api/compliance/status/route");
const overviewRoute = await import("@/app/api/compliance/overview/route");

const ADMIN = { sub: "admin-1", email: "lukefieldsend@googlemail.com", role: "admin" as const };
const NON_ADMIN = { sub: "talent-1", email: "t@x.com", role: "talent" as const };

describe("GET /api/compliance/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("400 when scope/id missing", async () => {
    t.setSession(ADMIN);
    expect((await statusRoute.GET(buildRequest("/api/compliance/status?scope=licence"))).status).toBe(400);
  });

  it("returns the obligation matrix + required-gap count for a licence", async () => {
    t.setSession(ADMIN); // authorizeScope short-circuits for admin (no licence load)

    const e0 = await hashEvent({ chainKey: "licence:L1", seq: 0, eventType: "consent.granted", payload: {} }, "licence:L1");
    const rows = [
      { chainKey: "licence:L1", seq: 0, eventType: "consent.granted", payloadJson: "{}", prevHash: e0.prevHash, hash: e0.hash, scopeJson: JSON.stringify({ useType: "ai_avatar" }), clauseRef: "39.B", createdAt: 1 },
    ];
    t.enqueue(rows); // loadChainEvents
    t.enqueue([{ licenceType: "ai_avatar", permitAiTraining: false }]); // loadLicenceMeta

    const res = await statusRoute.GET(buildRequest("/api/compliance/status?scope=licence&id=L1"));
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    const byClause = Object.fromEntries(json.obligations.map((o: any) => [o.clauseRef, o.status]));
    expect(byClause["39.B"]).toBe("met");
    expect(byClause["39.E"]).toBe("gap"); // no attestation
    expect(typeof json.requiredGaps).toBe("number");
  });

  it("authorises a production-scope request for an email-whitelisted admin whose role is talent", async () => {
    // Regression: admin is determined by email whitelist, not session.role.
    t.setSession({ sub: "u1", email: "lukefieldsend@googlemail.com", role: "talent" });
    t.enqueue([{ id: "L1" }]); // resolveLicenceIds(production)
    t.enqueue([]); // loadChainEvents(L1)
    t.enqueue([{ licenceType: "ai_avatar", permitAiTraining: false }]); // loadLicenceMeta

    const res = await statusRoute.GET(buildRequest("/api/compliance/status?scope=production&id=prod-1"));
    expect(res.status).toBe(200); // previously 403 → silent client failure
    expect((await parseJson(res)).licenceCount).toBe(1);
  });
});

describe("GET /api/compliance/overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("403 for a non-admin", async () => {
    t.setSession(NON_ADMIN);
    expect((await overviewRoute.GET(buildRequest("/api/compliance/overview"))).status).toBe(403);
  });

  it("returns cockpit data for an admin", async () => {
    t.setSession(ADMIN);
    t.enqueue([{ id: "s1", scope: "global", status: "active" }]); // strikes
    t.enqueue([{ id: "tr1", status: "requested" }]); // pendingTransfers
    t.enqueue([{ id: "e1", eventType: "consent.granted" }]); // recentEvents
    t.enqueue([{ id: "c1", scope: "licence", ledgerTipHash: "abc" }]); // certificates

    const res = await overviewRoute.GET(buildRequest("/api/compliance/overview"));
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.strikes).toHaveLength(1);
    expect(json.pendingTransfers).toHaveLength(1);
    expect(json.certificates).toHaveLength(1);
  });
});
