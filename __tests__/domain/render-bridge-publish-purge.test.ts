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

const [{ POST: publishComplete }, { POST: purgeComplete }] = await Promise.all([
  import("@/app/api/bridge/render-bridge/[agentId]/publish-complete/route"),
  import("@/app/api/bridge/render-bridge/[agentId]/purge-complete/route"),
]);

const AGENT_ID = "agent-002";
const validAuth = { agentId: AGENT_ID, organisationId: "org-1", status: "active" };

function makeParams(agentId: string) {
  return { params: Promise.resolve({ agentId }) };
}

// ─── publish-complete ────────────────────────────────────────────────────────

describe("POST /api/bridge/render-bridge/:agentId/publish-complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
    mockRequireRenderBridgeToken.mockResolvedValue(validAuth);
  });

  it("returns 401 for an invalid service token", async () => {
    mockRequireRenderBridgeToken.mockResolvedValue(
      NextResponse.json({ error: "Invalid service token" }, { status: 401 })
    );
    const res = await publishComplete(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/publish-complete`, {
        body: { packageId: "pkg-1" },
      }),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when agentId in URL does not match the token", async () => {
    const res = await publishComplete(
      buildRequest("/api/bridge/render-bridge/other/publish-complete", {
        body: { packageId: "pkg-1" },
      }),
      makeParams("other")
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when packageId is missing from body", async () => {
    const res = await publishComplete(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/publish-complete`, {
        body: {},
      }),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body.error).toContain("packageId");
  });

  it("returns 404 when the agent record does not exist", async () => {
    t.enqueue(undefined); // agent not found

    const res = await publishComplete(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/publish-complete`, {
        body: { packageId: "pkg-1" },
      }),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(404);
  });

  it("appends packageId to the existing published list and returns ok", async () => {
    t.enqueue({ publishedPackagesJson: JSON.stringify(["pkg-existing"]) });

    const res = await publishComplete(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/publish-complete`, {
        body: { packageId: "pkg-new" },
      }),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.ok).toBe(true);

    const updated = t.updatedRows[0]?.set as Record<string, unknown>;
    expect(JSON.parse(updated?.publishedPackagesJson as string)).toEqual(
      expect.arrayContaining(["pkg-existing", "pkg-new"])
    );
  });

  it("does not duplicate a packageId already in the published list", async () => {
    t.enqueue({ publishedPackagesJson: JSON.stringify(["pkg-1"]) });

    await publishComplete(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/publish-complete`, {
        body: { packageId: "pkg-1" },
      }),
      makeParams(AGENT_ID)
    );

    const updated = t.updatedRows[0]?.set as Record<string, unknown>;
    const stored = JSON.parse(updated?.publishedPackagesJson as string) as string[];
    expect(stored.filter(id => id === "pkg-1")).toHaveLength(1);
  });
});

// ─── purge-complete ──────────────────────────────────────────────────────────

describe("POST /api/bridge/render-bridge/:agentId/purge-complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
    mockRequireRenderBridgeToken.mockResolvedValue(validAuth);
  });

  it("returns 401 for an invalid service token", async () => {
    mockRequireRenderBridgeToken.mockResolvedValue(
      NextResponse.json({ error: "Invalid service token" }, { status: 401 })
    );
    const res = await purgeComplete(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/purge-complete`, { body: {} }),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when agentId in URL does not match the token", async () => {
    const res = await purgeComplete(
      buildRequest("/api/bridge/render-bridge/other/purge-complete", { body: {} }),
      makeParams("other")
    );
    expect(res.status).toBe(403);
  });

  it("clears publishedPackagesJson, nulls pendingAction, and updates lastHeartbeatAt", async () => {
    const res = await purgeComplete(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/purge-complete`, { body: {} }),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.ok).toBe(true);

    const updated = t.updatedRows[0]?.set as Record<string, unknown>;
    expect(updated?.publishedPackagesJson).toBe("[]");
    expect(updated?.pendingAction).toBeNull();
    expect(typeof updated?.lastHeartbeatAt).toBe("number");
  });
});
