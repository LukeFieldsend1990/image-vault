import { describe, it, expect } from "vitest";
import {
  COMPLIANCE_SCOPES,
  isAllowedScopeForSubtype,
  createGrant,
  GrantScopeError,
} from "@/lib/compliance/grants";
import { mockChainDb } from "../../helpers/mocks";

// A db whose every call throws — proves the validation guards short-circuit before
// any query runs.
const noDb = new Proxy({}, { get() { throw new Error("db should not be touched"); } }) as never;

describe("isAllowedScopeForSubtype", () => {
  it("exposes the union scope", () => {
    expect(COMPLIANCE_SCOPES).toContain("union");
  });

  it("permits the union scope only for union watchers", () => {
    expect(isAllowedScopeForSubtype("union", "union")).toBe(true);
    expect(isAllowedScopeForSubtype("regulator", "union")).toBe(false);
    expect(isAllowedScopeForSubtype("insurer", "union")).toBe(false);
  });

  it("keeps insurers bound to production/talent", () => {
    expect(isAllowedScopeForSubtype("insurer", "production")).toBe(true);
    expect(isAllowedScopeForSubtype("insurer", "talent")).toBe(true);
    expect(isAllowedScopeForSubtype("insurer", "platform")).toBe(false);
    expect(isAllowedScopeForSubtype("insurer", "organisation")).toBe(false);
  });

  it("allows union watchers the broad scopes too", () => {
    for (const scope of ["platform", "organisation", "production", "talent", "union"]) {
      expect(isAllowedScopeForSubtype("union", scope)).toBe(true);
    }
  });
});

describe("createGrant — union choice + union scope", () => {
  it("rejects a union grant with no unionId (every union watcher must pick a union)", async () => {
    await expect(
      createGrant(noDb, { complianceUserId: "u1", subtype: "union", scope: "platform", scopeId: null, grantedBy: null }),
    ).rejects.toBeInstanceOf(GrantScopeError);
  });

  it("rejects a union_id on a non-union subtype", async () => {
    await expect(
      createGrant(noDb, { complianceUserId: "u1", subtype: "insurer", scope: "production", scopeId: "p1", grantedBy: null, unionId: "sag_aftra" }),
    ).rejects.toBeInstanceOf(GrantScopeError);
  });

  it("rejects an unknown union", async () => {
    await expect(
      createGrant(noDb, { complianceUserId: "u1", subtype: "union", scope: "union", scopeId: null, grantedBy: null, unionId: "teamsters" }),
    ).rejects.toBeInstanceOf(GrantScopeError);
  });

  it("rejects the union scope for a regulator", async () => {
    await expect(
      createGrant(noDb, { complianceUserId: "u1", subtype: "regulator", scope: "union", scopeId: "sag_aftra", grantedBy: null }),
    ).rejects.toBeInstanceOf(GrantScopeError);
  });

  it("derives scope_id from the union id for a union-scope grant", async () => {
    const { db, enqueue, insertedRows } = mockChainDb();
    enqueue(undefined); // idempotency lookup → no existing grant
    const id = await createGrant(db as never, {
      complianceUserId: "u1",
      subtype: "union",
      scope: "union",
      scopeId: null, // intentionally omitted — must be derived from the union id
      grantedBy: "admin-1",
      unionId: "equity",
    });
    expect(typeof id).toBe("string");
    const inserted = insertedRows.at(-1)?.values as Record<string, unknown>;
    expect(inserted.scope).toBe("union");
    expect(inserted.scopeId).toBe("equity");
    expect(inserted.unionId).toBe("equity");
  });
});
