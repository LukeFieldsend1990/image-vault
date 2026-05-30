import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";

const t = createTestEnv();

vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: t.getRequestContext }));
vi.mock("@/lib/db", () => ({ getDb: t.getDb, getKv: t.getKv }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: t.requireSession,
  isErrorResponse: t.isErrorResponse,
}));

const route = await import("@/app/api/compliance/strikes/route");
const idRoute = await import("@/app/api/compliance/strikes/[id]/route");

const ADMIN = { sub: "admin-1", email: "lukefieldsend@googlemail.com", role: "admin" as const };
const NON_ADMIN = { sub: "talent-1", email: "talent@x.com", role: "talent" as const };

describe("compliance strikes API — authz", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("GET 401 without session", async () => {
    expect((await route.GET(buildRequest("/api/compliance/strikes"))).status).toBe(401);
  });

  it("GET 403 for a non-admin", async () => {
    t.setSession(NON_ADMIN);
    expect((await route.GET(buildRequest("/api/compliance/strikes"))).status).toBe(403);
  });

  it("POST 403 for a non-admin (only admin declares strikes)", async () => {
    t.setSession(NON_ADMIN);
    const res = await route.POST(buildRequest("/api/compliance/strikes", { body: { scope: "global", reason: "x" } }));
    expect(res.status).toBe(403);
  });
});

describe("declare / lift strike (admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("GET lists strikes for an admin", async () => {
    t.setSession(ADMIN);
    t.enqueue([{ id: "s1", scope: "global", status: "active" }]);
    const res = await route.GET(buildRequest("/api/compliance/strikes"));
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.strikes).toHaveLength(1);
  });

  it("POST 400 when scope is invalid", async () => {
    t.setSession(ADMIN);
    const res = await route.POST(buildRequest("/api/compliance/strikes", { body: { scope: "nonsense", reason: "x" } }));
    expect(res.status).toBe(400);
  });

  it("POST 400 when a non-global strike omits scopeId", async () => {
    t.setSession(ADMIN);
    const res = await route.POST(buildRequest("/api/compliance/strikes", { body: { scope: "licence", reason: "x" } }));
    expect(res.status).toBe(400);
  });

  it("POST declares a global strike", async () => {
    t.setSession(ADMIN);
    t.enqueue(null); // appendEvent tip
    const res = await route.POST(buildRequest("/api/compliance/strikes", { body: { scope: "global", reason: "SAG-AFTRA strike" } }));
    expect(res.status).toBe(201);
    const json = await parseJson(res);
    expect(json.ok).toBe(true);
    expect(json.id).toBeTruthy();
    const strikeRow = t.insertedRows.map((r) => r.values as any).find((v) => v.scope === "global");
    expect(strikeRow.status).toBe("active");
  });

  it("PATCH 409 when lifting a missing/already-lifted strike", async () => {
    t.setSession(ADMIN);
    t.enqueue(undefined); // strike lookup miss
    const res = await idRoute.PATCH(buildRequest("/api/compliance/strikes/s1", { method: "PATCH" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(409);
  });

  it("PATCH lifts an active strike", async () => {
    t.setSession(ADMIN);
    t.enqueue({ id: "s1", status: "active" }); // strike lookup
    t.enqueue(null); // appendEvent tip
    const res = await idRoute.PATCH(buildRequest("/api/compliance/strikes/s1", { method: "PATCH" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(200);
    expect((await parseJson(res)).status).toBe("lifted");
  });
});
