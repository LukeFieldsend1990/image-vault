import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";

const t = createTestEnv();
const mockRequireRenderBridgeToken = vi.fn();

vi.mock("@cloudflare/next-on-pages", () => ({
  getRequestContext: t.getRequestContext,
}));
vi.mock("@/lib/db", () => ({
  getDb: t.getDb,
  getKv: t.getKv,
}));
vi.mock("@/lib/auth/requireRenderBridgeToken", () => ({
  requireRenderBridgeToken: mockRequireRenderBridgeToken,
  isRenderBridgeTokenError: (r: unknown): r is NextResponse => r instanceof NextResponse,
}));

const { POST } = await import(
  "@/app/api/bridge/render-bridge/[agentId]/heartbeat/route"
);

const AGENT_ID = "agent-001";
const validAuth = { agentId: AGENT_ID, organisationId: "org-1", status: "active" };

function makeParams(agentId: string) {
  return { params: Promise.resolve({ agentId }) };
}

describe("POST /api/bridge/render-bridge/:agentId/heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
    mockRequireRenderBridgeToken.mockResolvedValue(validAuth);
  });

  it("returns 401 when service token is invalid", async () => {
    mockRequireRenderBridgeToken.mockResolvedValue(
      NextResponse.json({ error: "Invalid service token" }, { status: 401 })
    );
    const res = await POST(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/heartbeat`, { body: {} }),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when agentId in URL does not match the token's agentId", async () => {
    const res = await POST(
      buildRequest("/api/bridge/render-bridge/wrong-agent/heartbeat", { body: {} }),
      makeParams("wrong-agent")
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new (await import("next/server")).NextRequest(
      `http://localhost:3000/api/bridge/render-bridge/${AGENT_ID}/heartbeat`,
      { method: "POST", body: "not json" }
    );
    const res = await POST(req, makeParams(AGENT_ID));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the agent record does not exist in the DB", async () => {
    t.enqueue(undefined); // agent lookup → not found

    const res = await POST(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/heartbeat`, {
        body: { publishedPackages: [] },
      }),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(404);
    const body = await parseJson(res);
    expect(body.error).toBe("Agent not found");
  });

  it("returns action: null and clears pendingAction when no action is queued", async () => {
    t.enqueue({ pendingAction: null }); // agent has no pending action

    const res = await POST(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/heartbeat`, {
        body: { publishedPackages: ["pkg-1"] },
      }),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.ok).toBe(true);
    expect(body.action).toBeNull();
    expect(body.newToken).toBeNull();

    // pendingAction cleared in DB (even if already null)
    const updated = t.updatedRows[0]?.set as Record<string, unknown>;
    expect(updated?.pendingAction).toBeNull();
  });

  it("returns action: 'purge' and clears pendingAction from DB so it fires only once", async () => {
    t.enqueue({ pendingAction: "purge" }); // agent has purge queued

    const res = await POST(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/heartbeat`, {
        body: { publishedPackages: ["pkg-1"] },
      }),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.action).toBe("purge");

    // DB update must clear pendingAction so the next heartbeat returns null
    const updated = t.updatedRows[0]?.set as Record<string, unknown>;
    expect(updated?.pendingAction).toBeNull();
  });

  it("updates publishedPackagesJson from the body on every heartbeat", async () => {
    t.enqueue({ pendingAction: null });

    await POST(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/heartbeat`, {
        body: { publishedPackages: ["pkg-a", "pkg-b"] },
      }),
      makeParams(AGENT_ID)
    );

    const updated = t.updatedRows[0]?.set as Record<string, unknown>;
    expect(updated?.publishedPackagesJson).toBe(JSON.stringify(["pkg-a", "pkg-b"]));
  });

  it("returns a new service token and rotates the hash when action is 'rotate-token'", async () => {
    t.enqueue({ pendingAction: "rotate-token" });

    const res = await POST(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/heartbeat`, {
        body: { publishedPackages: [] },
      }),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.action).toBe("rotate-token");
    expect(typeof body.newToken).toBe("string");
    expect(body.newToken).toMatch(/^svc_[0-9a-f]{64}$/);

    // DB update must include new token hash and clear pendingAction
    const updated = t.updatedRows[0]?.set as Record<string, unknown>;
    expect(updated?.pendingAction).toBeNull();
    expect(typeof updated?.serviceTokenHash).toBe("string");
    expect(typeof updated?.tokenExpiresAt).toBe("number");
  });
});
