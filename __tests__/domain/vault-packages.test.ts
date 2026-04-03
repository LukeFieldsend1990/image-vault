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
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: t.requireSession,
  isErrorResponse: t.isErrorResponse,
}));
vi.mock("@/lib/auth/repAccess", () => ({
  hasRepAccess: t.hasRepAccess,
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: t.sendEmail,
}));

const { GET, POST } = await import("@/app/api/vault/packages/route");

describe("GET /api/vault/packages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns 401 without session", async () => {
    const res = await GET(buildRequest("/api/vault/packages"));
    expect(res.status).toBe(401);
  });

  it("returns packages for authenticated talent", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    t.enqueue([
      { id: "p1", name: "Head Scan", status: "ready", fileCount: 10 },
      { id: "p2", name: "Full Body", status: "uploading", fileCount: 3 },
    ]);

    const res = await GET(buildRequest("/api/vault/packages"));
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.packages).toHaveLength(2);
    expect(body.packages[0].name).toBe("Head Scan");
  });

  it("returns 403 if non-rep/admin uses ?for= param", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });

    const res = await GET(buildRequest("/api/vault/packages?for=t1"));
    expect(res.status).toBe(403);
  });

  it("rep can view managed talent's packages", async () => {
    t.setSession({ sub: "r1", email: "rep@test.com", role: "rep" });
    t.hasRepAccess.mockResolvedValueOnce(true);
    t.enqueue([
      { id: "p1", name: "Talent Head Scan", status: "ready", fileCount: 5 },
    ]);

    const res = await GET(buildRequest("/api/vault/packages?for=t1"));
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.packages).toHaveLength(1);
  });

  it("rep gets 403 for talent they don't manage", async () => {
    t.setSession({ sub: "r1", email: "rep@test.com", role: "rep" });
    t.hasRepAccess.mockResolvedValueOnce(false);

    const res = await GET(buildRequest("/api/vault/packages?for=t-other"));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/vault/packages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns 401 without session", async () => {
    const res = await POST(buildRequest("/api/vault/packages", { body: { name: "Test" } }));
    expect(res.status).toBe(401);
  });

  it("returns 400 if name is missing", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    const res = await POST(buildRequest("/api/vault/packages", { body: {} }));
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body.error).toContain("name");
  });

  it("returns 400 if name is blank", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });
    const res = await POST(buildRequest("/api/vault/packages", { body: { name: "  " } }));
    expect(res.status).toBe(400);
  });

  it("creates a package successfully", async () => {
    t.setSession({ sub: "t1", email: "talent@test.com", role: "talent" });

    const res = await POST(
      buildRequest("/api/vault/packages", {
        body: {
          name: "Head Scan Q1",
          description: "Full head with micro-detail",
          studioName: "Pinewood",
        },
      })
    );
    expect(res.status).toBe(201);
    const body = await parseJson(res);
    expect(body.packageId).toBeDefined();

    // Verify insert
    const inserted = t.insertedRows[0]?.values as any;
    expect(inserted.name).toBe("Head Scan Q1");
    expect(inserted.description).toBe("Full head with micro-detail");
    expect(inserted.studioName).toBe("Pinewood");
    expect(inserted.status).toBe("uploading");
  });

  it("rep can create package for managed talent", async () => {
    t.setSession({ sub: "r1", email: "rep@test.com", role: "rep" });
    t.hasRepAccess.mockResolvedValueOnce(true);

    const res = await POST(
      buildRequest("/api/vault/packages", {
        body: { name: "Rep-Created Scan", forTalentId: "t1" },
      })
    );
    expect(res.status).toBe(201);

    const inserted = t.insertedRows[0]?.values as any;
    expect(inserted.talentId).toBe("t1"); // package owned by talent, not rep
  });

  it("rep gets 403 for talent they don't manage", async () => {
    t.setSession({ sub: "r1", email: "rep@test.com", role: "rep" });
    t.hasRepAccess.mockResolvedValueOnce(false);

    const res = await POST(
      buildRequest("/api/vault/packages", {
        body: { name: "Unauthorized", forTalentId: "t-other" },
      })
    );
    expect(res.status).toBe(403);
  });

  it("licensee cannot create packages for others", async () => {
    t.setSession({ sub: "l1", email: "lic@test.com", role: "licensee" });

    const res = await POST(
      buildRequest("/api/vault/packages", {
        body: { name: "Nope", forTalentId: "t1" },
      })
    );
    expect(res.status).toBe(403);
  });
});
