/**
 * Pure-logic tests for the org-to-org visibility consent helpers
 * (lib/organisations/connections.ts). These cover the correctness-critical,
 * DB-free parts: canonical pairing, tier ranking, party membership, and the
 * exposed-tier resolver that gates all cross-org visibility.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalPair,
  tierRank,
  tierAtLeast,
  isVisibilityTier,
  counterpartyOrgId,
  myTierFor,
  exposedTierFor,
  isPartyTo,
  type ConnectionRow,
} from "@/lib/organisations/connections";

function conn(over: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    id: "c1",
    productionId: "p1",
    orgAId: "aaa",
    orgBId: "bbb",
    initiatedByOrgId: "aaa",
    status: "active",
    orgATier: "identity",
    orgBTier: "identity",
    ...over,
  };
}

describe("canonicalPair", () => {
  it("orders the two org ids lexically regardless of argument order", () => {
    expect(canonicalPair("zzz", "aaa")).toEqual({ orgAId: "aaa", orgBId: "zzz" });
    expect(canonicalPair("aaa", "zzz")).toEqual({ orgAId: "aaa", orgBId: "zzz" });
  });
});

describe("tier ranking", () => {
  it("is cumulative: shared_context ⊇ contacts ⊇ identity", () => {
    expect(tierRank("identity")).toBeLessThan(tierRank("contacts"));
    expect(tierRank("contacts")).toBeLessThan(tierRank("shared_context"));
    expect(tierAtLeast("shared_context", "contacts")).toBe(true);
    expect(tierAtLeast("identity", "contacts")).toBe(false);
    expect(tierAtLeast("contacts", "contacts")).toBe(true);
  });

  it("validates tier strings", () => {
    expect(isVisibilityTier("contacts")).toBe(true);
    expect(isVisibilityTier("nonsense")).toBe(false);
    expect(isVisibilityTier(undefined)).toBe(false);
  });
});

describe("party perspective helpers", () => {
  it("resolves the counterparty from either side", () => {
    const c = conn();
    expect(counterpartyOrgId(c, "aaa")).toBe("bbb");
    expect(counterpartyOrgId(c, "bbb")).toBe("aaa");
    expect(counterpartyOrgId(c, "other")).toBeNull();
  });

  it("returns the tier each side controls about itself", () => {
    const c = conn({ orgATier: "contacts", orgBTier: "shared_context" });
    expect(myTierFor(c, "aaa")).toBe("contacts");
    expect(myTierFor(c, "bbb")).toBe("shared_context");
    expect(myTierFor(c, "other")).toBeNull();
  });
});

describe("exposedTierFor (the visibility gate)", () => {
  it("exposes the COUNTERPARTY's tier to a viewer, not their own", () => {
    const c = conn({ orgATier: "identity", orgBTier: "contacts" });
    // viewer is A → sees what B exposes (contacts)
    expect(exposedTierFor(c, ["aaa"])).toBe("contacts");
    // viewer is B → sees what A exposes (identity)
    expect(exposedTierFor(c, ["bbb"])).toBe("identity");
  });

  it("reveals nothing unless the connection is active", () => {
    for (const status of ["pending", "declined", "revoked"] as const) {
      expect(exposedTierFor(conn({ status }), ["aaa"])).toBeNull();
    }
  });

  it("reveals nothing to a non-party viewer", () => {
    expect(exposedTierFor(conn(), ["someone-else"])).toBeNull();
    expect(exposedTierFor(conn(), [])).toBeNull();
  });
});

describe("isPartyTo", () => {
  const parties = { producerOrgId: "prod", vendorOrgIds: ["v1", "v2"] };
  it("recognises the producer and attached vendors as parties", () => {
    expect(isPartyTo(parties, "prod")).toBe(true);
    expect(isPartyTo(parties, "v2")).toBe(true);
    expect(isPartyTo(parties, "stranger")).toBe(false);
  });
});
