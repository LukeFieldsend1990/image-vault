import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { createTestEnv, buildRequest } from "../../helpers/mocks";

const t = createTestEnv();

vi.mock("@/lib/db", () => ({
  getDb: t.getDb,
}));

const { requireRenderBridgeToken, isRenderBridgeTokenError } = await import(
  "@/lib/auth/requireRenderBridgeToken"
);

describe("requireRenderBridgeToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns 401 when Authorization header is absent", async () => {
    const req = buildRequest("/api/bridge/render-bridge/agent1/heartbeat");
    const result = await requireRenderBridgeToken(req);
    expect(result instanceof NextResponse).toBe(true);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns 401 when Authorization header does not start with 'Bearer '", async () => {
    const req = buildRequest("/api/bridge/render-bridge/agent1/heartbeat", {
      headers: { authorization: "Token svc_abc123" },
    });
    const result = await requireRenderBridgeToken(req);
    expect(result instanceof NextResponse).toBe(true);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns 401 when the token hash is not found in the DB", async () => {
    t.enqueue(undefined); // agent not found

    const req = buildRequest("/api/bridge/render-bridge/agent1/heartbeat", {
      headers: { authorization: "Bearer svc_unknowntoken" },
    });
    const result = await requireRenderBridgeToken(req);
    expect(result instanceof NextResponse).toBe(true);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns 401 when revokedAt is set on the agent record", async () => {
    t.enqueue({
      id: "agent1",
      organisationId: "org1",
      status: "active",
      revokedAt: Math.floor(Date.now() / 1000) - 3600,
    });

    const req = buildRequest("/api/bridge/render-bridge/agent1/heartbeat", {
      headers: { authorization: "Bearer svc_sometoken" },
    });
    const result = await requireRenderBridgeToken(req);
    expect(result instanceof NextResponse).toBe(true);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns 401 when agent status is 'revoked'", async () => {
    t.enqueue({
      id: "agent1",
      organisationId: "org1",
      status: "revoked",
      revokedAt: null,
    });

    const req = buildRequest("/api/bridge/render-bridge/agent1/heartbeat", {
      headers: { authorization: "Bearer svc_sometoken" },
    });
    const result = await requireRenderBridgeToken(req);
    expect(result instanceof NextResponse).toBe(true);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns a payload whose organisationId comes from the agent record, not the token", async () => {
    t.enqueue({
      id: "agent-abc",
      organisationId: "org-from-db",
      status: "active",
      revokedAt: null,
    });

    const req = buildRequest("/api/bridge/render-bridge/agent-abc/heartbeat", {
      headers: { authorization: "Bearer svc_validtoken" },
    });
    const result = await requireRenderBridgeToken(req);
    expect(result instanceof NextResponse).toBe(false);

    const payload = result as { agentId: string; organisationId: string; status: string };
    expect(payload.agentId).toBe("agent-abc");
    expect(payload.organisationId).toBe("org-from-db");
    expect(payload.status).toBe("active");
  });

  describe("isRenderBridgeTokenError", () => {
    it("returns true for a NextResponse", () => {
      const err = NextResponse.json({ error: "test" }, { status: 401 });
      expect(isRenderBridgeTokenError(err)).toBe(true);
    });

    it("returns false for a valid payload object", () => {
      expect(
        isRenderBridgeTokenError({ agentId: "a", organisationId: "o", status: "active" })
      ).toBe(false);
    });
  });
});
