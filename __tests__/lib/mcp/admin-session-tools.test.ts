import { describe, it, expect, vi } from "vitest";

vi.mock("@cloudflare/next-on-pages", () => ({
  getRequestContext: () => {
    throw new Error("no request context in tests");
  },
}));

import { mockChainDb, mockKv } from "../../helpers/mocks";
import { getMcpTool } from "@/lib/mcp/registry";
import { isSessionRevoked, SESSION_REVOKED_PREFIX } from "@/lib/auth/requireSession";
import type { McpToolContext } from "@/lib/mcp/types";
import "@/lib/mcp/tools/administration";

const TOKEN = { tokenId: "tok-1", userId: "admin-1", email: "admin@example.com", scope: "admin" as const };

function ctx(db: unknown, kv?: unknown): McpToolContext {
  return { db, token: TOKEN, kv } as unknown as McpToolContext;
}

describe("isSessionRevoked", () => {
  it("returns false when there is no denylist entry", () => {
    expect(isSessionRevoked(null, 1000)).toBe(false);
  });
  it("revokes tokens issued before the revocation timestamp", () => {
    expect(isSessionRevoked("2000", 1999)).toBe(true);
  });
  it("allows tokens issued at or after the revocation timestamp (re-login works)", () => {
    expect(isSessionRevoked("2000", 2000)).toBe(false);
    expect(isSessionRevoked("2000", 2500)).toBe(false);
  });
  it("treats a missing iat as issued-at-0 (fails toward re-auth)", () => {
    expect(isSessionRevoked("2000", undefined)).toBe(true);
  });
  it("ignores a malformed denylist value", () => {
    expect(isSessionRevoked("not-a-number", 1)).toBe(false);
  });
});

describe("lock_talent_downloads", () => {
  const tool = getMcpTool("lock_talent_downloads")!;

  it("is registered and mutating", () => {
    expect(tool).toBeDefined();
    expect(tool.mutating).toBe(true);
  });

  it("locks a talent's vault", async () => {
    const { db, enqueue, updatedRows } = mockChainDb();
    enqueue({ id: "t1", email: "actor@example.com", role: "talent" }); // findTargetUser
    const res = await tool.execute(ctx(db), { email: "actor@example.com", locked: true, reason: "targeted" });
    expect(res.success).toBe(true);
    expect(res.message).toContain("Locked");
    expect(updatedRows.some((r) => (r.set as Record<string, unknown>).vaultLocked === true)).toBe(true);
  });

  it("refuses non-talent accounts", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue({ id: "l1", email: "buyer@example.com", role: "licensee" });
    const res = await tool.execute(ctx(db), { email: "buyer@example.com", locked: true });
    expect(res.success).toBe(false);
    expect(res.message).toContain("talent only");
  });
});

describe("revoke_user_sessions", () => {
  const tool = getMcpTool("revoke_user_sessions")!;

  it("is registered and mutating", () => {
    expect(tool).toBeDefined();
    expect(tool.mutating).toBe(true);
  });

  it("deletes refresh tokens and writes a denylist entry, without suspending by default", async () => {
    const { db, enqueue, updatedRows } = mockChainDb();
    enqueue({ id: "u1", email: "suspect@example.com", role: "rep" });
    const kv = mockKv();
    const res = await tool.execute(ctx(db, kv), { email: "suspect@example.com" });

    expect(res.success).toBe(true);
    expect(res.message).toContain("log in again");
    // denylist entry written under the user id
    expect(kv.put).toHaveBeenCalledWith(
      `${SESSION_REVOKED_PREFIX}u1`,
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
    // no suspendedAt update when suspend is not requested
    expect(updatedRows.some((r) => "suspendedAt" in (r.set as Record<string, unknown>))).toBe(false);
  });

  it("also suspends when suspend=true", async () => {
    const { db, enqueue, updatedRows } = mockChainDb();
    enqueue({ id: "u2", email: "suspect2@example.com", role: "licensee" });
    const kv = mockKv();
    const res = await tool.execute(ctx(db, kv), { email: "suspect2@example.com", suspend: true });

    expect(res.success).toBe(true);
    expect(res.message).toContain("suspended");
    expect(updatedRows.some((r) => "suspendedAt" in (r.set as Record<string, unknown>))).toBe(true);
  });

  it("fails cleanly when no KV is available (e.g. in-process caller)", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue({ id: "u3", email: "x@example.com", role: "rep" });
    const res = await tool.execute(ctx(db, undefined), { email: "x@example.com" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("unavailable");
  });

  it("refuses to touch admin accounts", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue({ id: "a1", email: "lukefieldsend@googlemail.com", role: "talent" });
    const kv = mockKv();
    const res = await tool.execute(ctx(db, kv), { email: "lukefieldsend@googlemail.com" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("Admin accounts cannot be modified");
    expect(kv.put).not.toHaveBeenCalled();
  });
});
