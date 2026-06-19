import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";

const t = createTestEnv();

const mockRequireBridgeToken = vi.fn();

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: t.getCloudflareContext,
}));
vi.mock("@/lib/db", () => ({
  getDb: t.getDb,
  getKv: t.getKv,
}));
vi.mock("@/lib/auth/requireBridgeToken", () => ({
  requireBridgeToken: mockRequireBridgeToken,
  isBridgeTokenError: (r: unknown): r is NextResponse => r instanceof NextResponse,
}));

const { POST } = await import("@/app/api/bridge/render-bridge/route");

const validAuth = { tokenId: "tok1", userId: "user1", role: "licensee", email: "user@org.com" };

describe("POST /api/bridge/render-bridge — enrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
    mockRequireBridgeToken.mockResolvedValue(validAuth);
  });

  it("returns 401 when bridge token auth fails", async () => {
    mockRequireBridgeToken.mockResolvedValue(
      NextResponse.json({ error: "Missing bridge token" }, { status: 401 })
    );

    const res = await POST(
      buildRequest("/api/bridge/render-bridge", {
        body: { organisationId: "org1", displayName: "bridge-01" },
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is missing organisationId", async () => {
    const res = await POST(
      buildRequest("/api/bridge/render-bridge", { body: { displayName: "bridge-01" } })
    );
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body.error).toMatch(/organisationId/);
  });

  it("returns 400 when body is missing displayName", async () => {
    const res = await POST(
      buildRequest("/api/bridge/render-bridge", { body: { organisationId: "org1" } })
    );
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body.error).toMatch(/displayName/);
  });

  it("returns 404 when the organisation does not exist", async () => {
    t.enqueue(undefined); // org lookup → not found

    const res = await POST(
      buildRequest("/api/bridge/render-bridge", {
        body: { organisationId: "nonexistent-org", displayName: "bridge-01" },
      })
    );
    expect(res.status).toBe(404);
    const body = await parseJson(res);
    expect(body.error).toBe("Organisation not found");
  });

  it("returns 403 when the brt_ token user is not a member of the requested org", async () => {
    t.enqueue({ id: "org1" }); // org exists
    t.enqueue(undefined);      // membership lookup → not found

    const res = await POST(
      buildRequest("/api/bridge/render-bridge", {
        body: { organisationId: "org1", displayName: "bridge-01" },
      })
    );
    expect(res.status).toBe(403);
    const body = await parseJson(res);
    expect(body.error).toBe("user is not a member of organisationId");
  });

  it("returns 201 with agentId, serviceToken, and tokenExpiresAt on success", async () => {
    t.enqueue({ id: "org1" });      // org exists
    t.enqueue({ userId: "user1" }); // membership found

    const res = await POST(
      buildRequest("/api/bridge/render-bridge", {
        body: { organisationId: "org1", displayName: "bridge-01" },
      })
    );
    expect(res.status).toBe(201);
    const body = await parseJson(res);
    expect(typeof body.agentId).toBe("string");
    expect(body.serviceToken).toMatch(/^svc_[0-9a-f]{64}$/);
    expect(typeof body.tokenExpiresAt).toBe("string");
  });

  it("persists the organisationId from the request body, not from the token", async () => {
    t.enqueue({ id: "org1" });
    t.enqueue({ userId: "user1" });

    await POST(
      buildRequest("/api/bridge/render-bridge", {
        body: { organisationId: "org1", displayName: "bridge-01" },
      })
    );

    const inserted = t.insertedRows[0]?.values as Record<string, unknown>;
    expect(inserted?.organisationId).toBe("org1");
  });

  it("silently ignores vendorId in the request body and omits it from the response", async () => {
    t.enqueue({ id: "org1" });
    t.enqueue({ userId: "user1" });

    const res = await POST(
      buildRequest("/api/bridge/render-bridge", {
        body: {
          organisationId: "org1",
          displayName: "bridge-01",
          vendorId: "LEGACY_VENDOR_ID",
        },
      })
    );
    expect(res.status).toBe(201);
    const body = await parseJson(res);
    expect(body.vendorId).toBeUndefined();

    const inserted = t.insertedRows[0]?.values as Record<string, unknown>;
    expect(inserted?.vendorId).toBeUndefined();
  });

  it("accepts managedSharePath and platformInfo from the bridge container without error", async () => {
    t.enqueue({ id: "org1" });
    t.enqueue({ userId: "user1" });

    const res = await POST(
      buildRequest("/api/bridge/render-bridge", {
        body: {
          organisationId: "org1",
          displayName: "bridge-01",
          managedSharePath: "/srv/render/share",
          platformInfo: "Linux 6.8 x86_64",
        },
      })
    );
    expect(res.status).toBe(201);
  });
});
