import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";

const t = createTestEnv();

vi.mock("@cloudflare/next-on-pages", () => ({
  getRequestContext: t.getRequestContext,
}));
vi.mock("@/lib/db", () => ({
  getDb: t.getDb,
  getKv: t.getKv,
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: t.sendEmail,
}));

// We need to also mock password module partially — let actual crypto work
// but we need getDb to be mocked first
const { POST } = await import("@/app/api/auth/login/route");

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new (await import("next/server")).NextRequest(
      "http://localhost:3000/api/auth/login",
      { method: "POST", body: "not json" }
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body.error).toBe("Invalid JSON");
  });

  it("returns 400 when email or password missing", async () => {
    const res = await POST(buildRequest("/api/auth/login", { body: { email: "a@b.c" } }));
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body.error).toContain("required");
  });

  it("returns 401 for non-existent user (with timing protection)", async () => {
    // First DB query (user lookup) returns null
    t.enqueue(undefined);

    const res = await POST(
      buildRequest("/api/auth/login", {
        body: { email: "nobody@test.com", password: "password123456" },
      })
    );
    expect(res.status).toBe(401);
    const body = await parseJson(res);
    expect(body.error).toBe("Invalid email or password");
  });

  it("returns 401 for wrong password", async () => {
    // User exists with a known hash
    t.enqueue({
      id: "u1",
      email: "user@test.com",
      passwordHash: "pbkdf2:v1:100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000",
      role: "talent",
      suspendedAt: null,
    });

    const res = await POST(
      buildRequest("/api/auth/login", {
        body: { email: "user@test.com", password: "wrong-password!!" },
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for suspended user", async () => {
    // Need to provide a user with correct password — use hashPassword
    const { hashPassword } = await import("@/lib/auth/password");
    const hash = await hashPassword("correct-pass!!");

    t.enqueue({
      id: "u1",
      email: "suspended@test.com",
      passwordHash: hash,
      role: "talent",
      suspendedAt: 1700000000,
    });

    const res = await POST(
      buildRequest("/api/auth/login", {
        body: { email: "suspended@test.com", password: "correct-pass!!" },
      })
    );
    expect(res.status).toBe(403);
    const body = await parseJson(res);
    expect(body.error).toContain("suspended");
  });

  it("returns setup redirect when 2FA not configured", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    const hash = await hashPassword("correct-pass!!");

    // User lookup
    t.enqueue({
      id: "u1",
      email: "new@test.com",
      passwordHash: hash,
      role: "talent",
      suspendedAt: null,
    });
    // TOTP lookup — no credentials
    t.enqueue(undefined);

    const res = await POST(
      buildRequest("/api/auth/login", {
        body: { email: "new@test.com", password: "correct-pass!!" },
      })
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.redirect).toMatch(/\/setup-2fa\?token=/);
    // Should have stored setup token in KV
    expect(t.kv.put).toHaveBeenCalled();
  });

  it("returns pendingToken when 2FA is configured", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    const hash = await hashPassword("correct-pass!!");

    // User lookup
    t.enqueue({
      id: "u1",
      email: "user@test.com",
      passwordHash: hash,
      role: "talent",
      suspendedAt: null,
    });
    // TOTP lookup — verified
    t.enqueue({ id: "t1", userId: "u1", secret: "ABCDEFGH", verified: true });

    const res = await POST(
      buildRequest("/api/auth/login", {
        body: { email: "user@test.com", password: "correct-pass!!" },
      })
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.pendingToken).toBeDefined();
    expect(typeof body.pendingToken).toBe("string");
  });
});
