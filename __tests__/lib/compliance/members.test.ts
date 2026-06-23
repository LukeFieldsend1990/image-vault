import { describe, it, expect } from "vitest";
import { parseMemberNames, resolveRosterUnion } from "@/lib/compliance/members";
import { mockChainDb } from "../../helpers/mocks";

describe("parseMemberNames", () => {
  it("splits on commas and new lines", () => {
    expect(parseMemberNames("Jane Doe, John Smith\nAlex Rivera")).toEqual(["Jane Doe", "John Smith", "Alex Rivera"]);
  });

  it("trims, collapses inner whitespace, and drops blanks", () => {
    expect(parseMemberNames("  Jane   Doe ,, ,\n\n  John  Smith  ")).toEqual(["Jane Doe", "John Smith"]);
  });

  it("de-duplicates case/punctuation-insensitively within the batch", () => {
    expect(parseMemberNames("Jane Doe, jane doe, JANE  DOE")).toEqual(["Jane Doe"]);
  });

  it("returns an empty array for an empty / separator-only blob", () => {
    expect(parseMemberNames("  , ,\n , ")).toEqual([]);
  });
});

describe("resolveRosterUnion", () => {
  const grant = (over: Partial<{ subtype: string; unionId: string | null; scope: string; scopeId: string | null }>) => ({
    id: crypto.randomUUID(),
    subtype: "union",
    unionId: null as string | null,
    scope: "platform",
    scopeId: null as string | null,
    createdAt: 0,
    ...over,
  });

  // For a non-admin, resolveRosterUnion makes a single getUnionIdsForUser lookup
  // (getActiveGrants → one .all()); enqueue that watcher's grants once.
  const watcher = { sub: "u1", email: "watcher@example.com", role: "compliance" };

  it("admins manage every union preset (no grant lookup)", async () => {
    const { db } = mockChainDb();
    const ctx = await resolveRosterUnion(db as never, { sub: "a1", email: "lukefieldsend@googlemail.com", role: "admin" });
    expect("error" in ctx).toBe(false);
    if ("error" in ctx) return;
    expect(ctx.available.map((u) => u.id).sort()).toEqual(["equity", "sag_aftra"]);
  });

  it("forbids a platform-wide regulator — the roster is union-owned, not a cross-union surface", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue([grant({ subtype: "regulator", unionId: null, scope: "platform" })]);
    const ctx = await resolveRosterUnion(db as never, watcher);
    expect(ctx).toEqual({ error: "Forbidden", status: 403 });
  });

  it("a union watcher with a platform-scoped union grant is scoped to that union", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue([grant({ subtype: "union", unionId: "equity", scope: "platform" })]);
    const ctx = await resolveRosterUnion(db as never, watcher);
    expect("error" in ctx).toBe(false);
    if ("error" in ctx) return;
    expect(ctx.available.map((u) => u.id)).toEqual(["equity"]);
    expect(ctx.unionId).toBe("equity");
  });

  it("forbids a union watcher whose grant is scoped below platform (no whole-union list)", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue([grant({ subtype: "union", unionId: "equity", scope: "organisation", scopeId: "org1" })]);
    const ctx = await resolveRosterUnion(db as never, watcher);
    expect(ctx).toEqual({ error: "Forbidden", status: 403 });
  });

  it("rejects a union the watcher doesn't hold", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue([grant({ subtype: "union", unionId: "equity", scope: "platform" })]);
    const ctx = await resolveRosterUnion(db as never, watcher, "sag_aftra");
    expect(ctx).toEqual({ error: "No access to that union", status: 403 });
  });
});
