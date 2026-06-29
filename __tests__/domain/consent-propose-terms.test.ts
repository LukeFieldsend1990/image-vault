/**
 * Invariant: across every consent surface, ticking a DIFFERENT set of uses than
 * was requested = "proposing different terms" (a counter recorded on the
 * negotiation thread), NOT a silent partial-consent record. Confirming the
 * requested set finalises consent. These tests lock that rule for:
 *   - the public tokenised surface (unregistered performer)  → cast thread
 *   - the cast pre-negotiation surface (reserved rep)         → cast thread
 *   - the registered licence surface (talent/rep)             → licence thread (parity)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";

const t = createTestEnv();

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: t.getCloudflareContext }));
vi.mock("@/lib/db", () => ({ getDb: t.getDb, getKv: t.getKv }));
vi.mock("@/lib/auth/requireSession", () => ({ requireSession: t.requireSession, isErrorResponse: t.isErrorResponse }));
vi.mock("@/lib/email/send", () => ({ sendEmail: t.sendEmail }));

const tokenAccept = await import("@/app/api/consent/access/[token]/accept/route");
const castCounter = await import("@/app/api/consent/cast/[castId]/counter/route");
const licenceAccept = await import("@/app/api/consent/[id]/accept/route");

const findInsert = (pred: (v: Record<string, unknown>) => boolean) =>
  t.insertedRows.map((r) => r.values as Record<string, unknown>).find(pred);
const statusSetToConsented = () =>
  t.updatedRows.find((u) => (u.set as { status?: string } | null)?.status === "consented");
const findCounterRound = () =>
  findInsert((v) => v.action === "counter" && (v.party === "talent" || v.party === "rep") && "proposedScopeJson" in v);

const REQUESTED = ["vfx-this", "reuse"];
const CAST_OFFER_TERMS = { licenceTermsJson: JSON.stringify({ useCategoryIds: REQUESTED, proposedFee: null }) };

async function mintToken() {
  const now = Math.floor(Date.now() / 1000);
  await t.kv.put(
    "consent_token:tok",
    JSON.stringify({ castId: "cast-1", productionId: "prod-1", email: "perf@example.com", createdAt: now, expiresAt: now + 100000 }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  t.reset();
});

describe("POST /api/consent/access/[token]/accept (unregistered performer)", () => {
  it("400 without attestation", async () => {
    await mintToken();
    const res = await tokenAccept.POST(
      buildRequest("/api/consent/access/tok/accept", { body: { uses: REQUESTED } }),
      { params: Promise.resolve({ token: "tok" }) },
    );
    expect(res.status).toBe(400);
  });

  it("altered scope = a counter on the cast thread, consent NOT finalised", async () => {
    await mintToken();
    t.enqueue({ id: "cast-1", status: "invited", addedBy: "prod-user", repId: "rep-1" }); // cast lookup
    t.enqueue(CAST_OFFER_TERMS); // getCastOffer terms
    t.enqueue([]);               // listCastNegotiationRounds (round numbering)

    const res = await tokenAccept.POST(
      buildRequest("/api/consent/access/tok/accept", { body: { uses: ["vfx-this"], attested: true } }),
      { params: Promise.resolve({ token: "tok" }) },
    );
    const json = await parseJson(res);
    expect(json.countered).toBe(true);

    const round = findCounterRound();
    expect(round).toBeTruthy();
    expect(round.castId).toBe("cast-1");
    expect(round.licenceId ?? null).toBeNull();
    expect(round.party).toBe("talent");
    expect(round.proposedScopeJson).toBe(JSON.stringify(["vfx-this"]));

    // Must NOT have finalised: no consent acceptance recorded, no status flip.
    expect(findInsert((v) => v.acceptedByRole === "guest")).toBeUndefined();
    expect(statusSetToConsented()).toBeUndefined();
  });

  it("matching scope finalises consent (no counter)", async () => {
    await mintToken();
    t.enqueue({ id: "cast-1", status: "invited", addedBy: "prod-user", repId: "rep-1" }); // cast lookup
    t.enqueue(CAST_OFFER_TERMS); // getCastOffer terms

    const res = await tokenAccept.POST(
      buildRequest("/api/consent/access/tok/accept", { body: { uses: REQUESTED, attested: true } }),
      { params: Promise.resolve({ token: "tok" }) },
    );
    const json = await parseJson(res);
    expect(json.countered).toBeUndefined();
    expect(json.ok).toBe(true);

    expect(findInsert((v) => v.acceptedByRole === "guest" && v.castId === "cast-1")).toBeTruthy();
    expect(statusSetToConsented()).toBeTruthy();
    expect(findCounterRound()).toBeUndefined();
  });
});

describe("POST /api/consent/cast/[castId]/counter (reserved rep pre-negotiation)", () => {
  it("a rep ticking a different scope records a rep counter on the cast thread", async () => {
    t.setSession({ sub: "rep-1", email: "rep@example.com", role: "rep" });
    // authorizeCastConsent cast lookup → rep matches repId
    t.enqueue({ id: "cast-1", productionId: "prod-1", repId: "rep-1", talentId: null, status: "placeholder", addedBy: "prod-user" });
    t.enqueue([]); // listCastNegotiationRounds for round numbering

    const res = await castCounter.POST(
      buildRequest("/api/consent/cast/cast-1/counter", { body: { scope: ["vfx-this"], comment: "VFX only" } }),
      { params: Promise.resolve({ castId: "cast-1" }) },
    );
    const json = await parseJson(res);
    expect(json.ok).toBe(true);

    const round = findCounterRound();
    expect(round).toBeTruthy();
    expect(round.castId).toBe("cast-1");
    expect(round.party).toBe("rep");
    expect(round.action).toBe("counter");
    expect(round.proposedScopeJson).toBe(JSON.stringify(["vfx-this"]));
  });
});

describe("POST /api/consent/[id]/accept (registered surface — parity)", () => {
  it("altered scope = a counter on the licence thread, consent NOT finalised", async () => {
    t.setSession({ sub: "talent-1", email: "t@example.com", role: "talent" });
    // authorizeLicenceConsent licence lookup (talent owns it → no rep query)
    t.enqueue({ id: "lic-1", talentId: "talent-1", licenseeId: "prod-user" });
    // route's own licence select (useCategoriesJson + proposedFee)
    t.enqueue({ useCategoriesJson: JSON.stringify(REQUESTED), proposedFee: null });
    t.enqueue([]); // listNegotiationRounds for round numbering

    const res = await licenceAccept.POST(
      buildRequest("/api/consent/lic-1/accept", { body: { uses: ["vfx-this"], attested: true } }),
      { params: Promise.resolve({ id: "lic-1" }) },
    );
    const json = await parseJson(res);
    expect(json.countered).toBe(true);

    const round = findCounterRound();
    expect(round).toBeTruthy();
    expect(round.licenceId).toBe("lic-1");
    expect(round.party).toBe("talent");
    expect(round.proposedScopeJson).toBe(JSON.stringify(["vfx-this"]));
    // Not finalised.
    expect(findInsert((v) => v.acceptedByRole === "talent")).toBeUndefined();
  });
});
