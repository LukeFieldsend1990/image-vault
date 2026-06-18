import { describe, it, expect } from "vitest";
import { evaluateObligations, listRegimes, getRegime, isAiBearing } from "@/lib/compliance/registry";
import "@/lib/compliance/regimes"; // side-effect registration
import type { EvaluatedEvent, LicenceLike } from "@/lib/compliance/types";

const aiLicence: LicenceLike = { licenceType: "ai_avatar", permitAiTraining: false };
const filmDoubleLicence: LicenceLike = { licenceType: "film_double", permitAiTraining: false };

const clause = (results: ReturnType<typeof evaluateObligations>, ref: string) =>
  results.find((o) => o.clauseRef === ref);

describe("regime registration", () => {
  it("registers SAG-AFTRA + UK Equity plus the two stubs", () => {
    const ids = listRegimes().map((r) => r.id).sort();
    expect(ids).toEqual(["bipa", "equity", "gdpr", "sag_aftra"]);
    expect(getRegime("sag_aftra")?.obligations.length).toBeGreaterThan(0);
    expect(getRegime("equity")?.obligations.length).toBeGreaterThan(0);
    // gdpr / bipa remain stubs pending review
    expect(getRegime("gdpr")?.obligations).toEqual([]);
  });
});

describe("isAiBearing", () => {
  it("recognises AI licence types and the permit flag", () => {
    expect(isAiBearing({ licenceType: "ai_avatar" })).toBe(true);
    expect(isAiBearing({ licenceType: "training_data" })).toBe(true);
    expect(isAiBearing({ licenceType: "film_double", permitAiTraining: true })).toBe(true);
    expect(isAiBearing({ licenceType: "film_double" })).toBe(false);
  });
});

describe("SAG-AFTRA obligation evaluation", () => {
  it("marks 39.D met when a dub-language consent event exists for the language", () => {
    const r = evaluateObligations("sag_aftra", aiLicence, [
      { eventType: "consent.dub_language_granted", scope: { language: "fr" } },
    ]);
    expect(clause(r, "39.D")?.status).toBe("met");
  });

  it("marks 39.E/H as gaps when no attestation is present", () => {
    const r = evaluateObligations("sag_aftra", aiLicence, []);
    expect(clause(r, "39.E")?.status).toBe("gap");
    expect(clause(r, "39.H")?.status).toBe("gap");
  });

  it("skips clause 39.F entirely (deferred — not registered)", () => {
    const r = evaluateObligations("sag_aftra", aiLicence, []);
    expect(r.some((o) => o.clauseRef === "39.F")).toBe(false);
  });

  it("39.C only applies to AI-bearing licences (appliesWhen gate)", () => {
    const filmOnly = evaluateObligations("sag_aftra", filmDoubleLicence, []);
    expect(filmOnly.some((o) => o.clauseRef === "39.C")).toBe(false);
    const ai = evaluateObligations("sag_aftra", aiLicence, []);
    expect(ai.some((o) => o.clauseRef === "39.C")).toBe(true);
  });

  it("a revoked consent does not satisfy its obligation", () => {
    const events: EvaluatedEvent[] = [
      { eventType: "consent.granted", scope: { useType: "ai_avatar" } },
      { eventType: "consent.revoked", scope: { useType: "ai_avatar" } },
    ];
    expect(clause(evaluateObligations("sag_aftra", aiLicence, events), "39.B")?.status).toBe("gap");
  });

  it("39.B is met when a non-revoked grant exists", () => {
    const r = evaluateObligations("sag_aftra", aiLicence, [
      { eventType: "consent.granted", scope: { useType: "ai_avatar" } },
    ]);
    expect(clause(r, "39.B")?.status).toBe("met");
  });

  it("39.I is n/a until a transfer is requested, then gap until approved, then met", () => {
    expect(clause(evaluateObligations("sag_aftra", aiLicence, []), "39.I")?.status).toBe("n/a");
    expect(
      clause(
        evaluateObligations("sag_aftra", aiLicence, [{ eventType: "transfer.requested" }]),
        "39.I",
      )?.status,
    ).toBe("gap");
    expect(
      clause(
        evaluateObligations("sag_aftra", aiLicence, [
          { eventType: "transfer.requested" },
          { eventType: "transfer.approved" },
        ]),
        "39.I",
      )?.status,
    ).toBe("met");
  });
});

describe("UK Equity obligation evaluation", () => {
  const byId = (results: ReturnType<typeof evaluateObligations>, id: string) => results.find((o) => o.id === id);

  it("explicit consent + performers' consent are both met by a licence grant", () => {
    const r = evaluateObligations("equity", aiLicence, [
      { eventType: "consent.granted", scope: { useType: "ai_avatar" } },
    ]);
    expect(byId(r, "equity-explicit-consent")?.status).toBe("met");
    expect(byId(r, "equity-performers-consent")?.status).toBe("met");
  });

  it("a withdrawn (revoked) consent drops explicit consent back to a gap", () => {
    const events: EvaluatedEvent[] = [
      { eventType: "consent.granted", scope: { useType: "ai_avatar" } },
      { eventType: "consent.revoked", scope: { useType: "ai_avatar" } },
    ];
    expect(byId(evaluateObligations("equity", aiLicence, events), "equity-explicit-consent")?.status).toBe("gap");
  });

  it("security + data-minimisation are gaps until attested", () => {
    const r = evaluateObligations("equity", aiLicence, []);
    expect(byId(r, "equity-data-security")?.status).toBe("gap");
    expect(byId(r, "equity-data-minimisation")?.status).toBe("gap");
  });

  it("fair-remuneration metering only applies to AI-bearing licences", () => {
    expect(evaluateObligations("equity", filmDoubleLicence, []).some((o) => o.id === "equity-fair-remuneration")).toBe(false);
    expect(evaluateObligations("equity", aiLicence, []).some((o) => o.id === "equity-fair-remuneration")).toBe(true);
  });

  it("onward transfer is n/a until requested, then gap until approved", () => {
    expect(byId(evaluateObligations("equity", aiLicence, []), "equity-onward-transfer")?.status).toBe("n/a");
    expect(byId(evaluateObligations("equity", aiLicence, [{ eventType: "transfer.requested" }]), "equity-onward-transfer")?.status).toBe("gap");
  });
});
