import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";
import { hashEvent } from "@/lib/compliance/ledger";
import { computeScopeTip } from "@/lib/compliance/certificate";

const t = createTestEnv();

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: t.getCloudflareContext }));
vi.mock("@/lib/db", () => ({ getDb: t.getDb, getKv: t.getKv }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: t.requireSession,
  isErrorResponse: t.isErrorResponse,
}));

const certRoute = await import("@/app/api/compliance/certificates/route");
const verifyRoute = await import("@/app/api/compliance/verify/route");

const ADMIN = { sub: "admin-1", email: "lukefieldsend@googlemail.com", role: "admin" as const };

// Build two-event chain rows for licence L1 (consent.granted + biometric attestation).
async function chainRows() {
  const e0 = await hashEvent({ chainKey: "licence:L1", seq: 0, eventType: "consent.granted", payload: {} }, "licence:L1");
  const e1 = await hashEvent(
    { chainKey: "licence:L1", seq: 1, eventType: "biometric.isolation_attested", payload: { attestationType: "biometric_isolation" } },
    e0.hash,
  );
  const rows = [
    { chainKey: "licence:L1", seq: 0, eventType: "consent.granted", payloadJson: "{}", prevHash: e0.prevHash, hash: e0.hash, scopeJson: JSON.stringify({ useType: "ai_avatar" }), clauseRef: "39.B", createdAt: 1 },
    { chainKey: "licence:L1", seq: 1, eventType: "biometric.isolation_attested", payloadJson: JSON.stringify({ attestationType: "biometric_isolation" }), prevHash: e1.prevHash, hash: e1.hash, scopeJson: "{}", clauseRef: "39.E", createdAt: 2 },
  ];
  return { rows, tip: e1.hash };
}

describe("POST /api/compliance/certificates — generate (the hero)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("generates a licence certificate: obligation matrix, sealed tip hash, R2 write, cert row", async () => {
    const putSpy = vi.fn(async () => {});
    (t.env as any).SCANS_BUCKET = { put: putSpy, get: vi.fn() };
    t.setSession(ADMIN);

    const { rows, tip } = await chainRows();
    t.enqueue(rows); // loadChainEvents
    t.enqueue([{ licenceType: "ai_avatar", permitAiTraining: false }]); // loadLicenceMeta
    t.enqueue([]); // loadUsageSummary
    t.enqueue([]); // loadDownloadCount

    const res = await certRoute.POST(buildRequest("/api/compliance/certificates", { body: { scope: "licence", scopeId: "L1" } }));
    expect(res.status).toBe(201);
    const json = await parseJson(res);

    expect(json.eventCount).toBe(2);
    const byClause = Object.fromEntries(json.obligations.map((o: any) => [o.clauseRef, o.status]));
    expect(byClause["39.B"]).toBe("met"); // consent.granted present
    expect(byClause["39.E"]).toBe("met"); // biometric attestation present

    expect(putSpy).toHaveBeenCalledOnce();
    expect(json.ledgerTipHash).toBe(await computeScopeTip([{ licenceId: "L1", tip }]));

    const certRow = t.insertedRows.map((r) => r.values as any).find((v) => v.r2Key?.startsWith("compliance-certs/"));
    expect(certRow.ledgerTipHash).toBe(json.ledgerTipHash);
    expect(certRow.eventCount).toBe(2);
  });

  it("400 on an invalid scope", async () => {
    t.setSession(ADMIN);
    const res = await certRoute.POST(buildRequest("/api/compliance/certificates", { body: { scope: "bogus", scopeId: "L1" } }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/compliance/verify — tamper seal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("ok:true when the ledger is unchanged since issuance", async () => {
    t.setSession(ADMIN);
    const { rows, tip } = await chainRows();
    const sealedTip = await computeScopeTip([{ licenceId: "L1", tip }]);

    t.enqueue({ scope: "licence", scopeId: "L1" }); // route cert lookup (scope/scopeId)
    t.enqueue({ scope: "licence", scopeId: "L1", ledgerTipHash: sealedTip }); // verifyCertificate cert lookup
    t.enqueue(rows); // loadChainEvents

    const res = await verifyRoute.GET(buildRequest("/api/compliance/verify?certificateId=cert-1"));
    expect(res.status).toBe(200);
    expect((await parseJson(res)).ok).toBe(true);
  });

  it("ok:false when a ledger event was altered after issuance", async () => {
    t.setSession(ADMIN);
    const { rows, tip } = await chainRows();
    const sealedTip = await computeScopeTip([{ licenceId: "L1", tip }]);
    const tampered = rows.map((r) => (r.seq === 1 ? { ...r, payloadJson: JSON.stringify({ tampered: true }) } : r));

    t.enqueue({ scope: "licence", scopeId: "L1" });
    t.enqueue({ scope: "licence", scopeId: "L1", ledgerTipHash: sealedTip });
    t.enqueue(tampered); // loadChainEvents returns mutated content; hash no longer matches

    const res = await verifyRoute.GET(buildRequest("/api/compliance/verify?certificateId=cert-1"));
    expect(res.status).toBe(200);
    expect((await parseJson(res)).ok).toBe(false);
  });
});
