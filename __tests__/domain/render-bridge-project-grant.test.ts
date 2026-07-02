import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";

const t = createTestEnv();

const mockRequireRenderBridgeToken = vi.fn();

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: t.getCloudflareContext,
}));
vi.mock("@/lib/db", () => ({
  getDb: t.getDb,
  getKv: t.getKv,
}));
vi.mock("@/lib/auth/requireRenderBridgeToken", () => ({
  requireRenderBridgeToken: mockRequireRenderBridgeToken,
  isRenderBridgeTokenError: (r: unknown): r is NextResponse => r instanceof NextResponse,
}));
// Stub aws4fetch so presignGet doesn't make real network calls
vi.mock("aws4fetch", () => ({
  AwsClient: class {
    async sign(req: Request): Promise<Request> {
      return req;
    }
  },
}));

const { GET } = await import(
  "@/app/api/bridge/render-bridge/[agentId]/project-grant/route"
);

const AGENT_ID = "agent-123";
const ORG_ID = "org-456";
const validAuth = { agentId: AGENT_ID, organisationId: ORG_ID, status: "active" };

function makeParams(agentId: string) {
  return { params: Promise.resolve({ agentId }) };
}

describe("GET /api/bridge/render-bridge/:agentId/project-grant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
    mockRequireRenderBridgeToken.mockResolvedValue(validAuth);
  });

  it("returns 401 when the service token is invalid", async () => {
    mockRequireRenderBridgeToken.mockResolvedValue(
      NextResponse.json({ error: "Invalid service token" }, { status: 401 })
    );

    const res = await GET(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/project-grant`),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when the agentId in the URL does not match the token's agentId", async () => {
    const res = await GET(
      buildRequest("/api/bridge/render-bridge/other-agent/project-grant"),
      makeParams("other-agent")
    );
    expect(res.status).toBe(403);
    const body = await parseJson(res);
    expect(body.error).toBe("Forbidden");
  });

  it("returns 404 when no active licences exist for the org", async () => {
    t.enqueue({ name: "Test Org" }); // org name lookup
    t.enqueue([{ userId: "user1" }]); // member IDs
    t.enqueue([]); // licences — empty

    const res = await GET(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/project-grant`),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(404);
    const body = await parseJson(res);
    expect(body.error).toMatch(/No active licences/);
  });

  it("returns 200 with org-scoped grant including packages and files", async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 86400;

    t.enqueue({ name: "Acme Studios" }); // org name lookup
    t.enqueue([{ userId: "user1" }]);    // member IDs
    t.enqueue([{                         // active licences
      id: "lic-1",
      packageId: "pkg-1",
      validTo: futureExpiry,
      fileScope: null,
      productionId: null,
    }]);
    t.enqueue([]);                       // justExpired scrub-period sweep
    t.enqueue([{                         // files for pkg-1
      id: "file-1",
      filename: "body_scan.usd",
      r2Key: "scans/pkg-1/body_scan.usd",
      sizeBytes: 2048,
      sha256: "deadbeef",
      uploadStatus: "complete",
    }]);

    const res = await GET(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/project-grant`),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);

    expect(body.organisationId).toBe(ORG_ID);
    expect(body.licenceeOrganisation).toBe("Acme Studios");
    expect(body.packages).toHaveLength(1);
    expect(body.packages[0].packageId).toBe("pkg-1");
    expect(body.packages[0].licenceId).toBe("lic-1");
    expect(body.packages[0].files).toHaveLength(1);
    expect(body.packages[0].files[0].filename).toBe("body_scan.usd");
    expect(body.packages[0].files[0].size).toBe(2048);
    expect(body.packages[0].files[0].sha256).toBe("deadbeef");
    // presign URL should be a string (returned by our mock AwsClient)
    expect(typeof body.packages[0].files[0].sourceUrl).toBe("string");
  });

  it("excludes files that are not in uploadStatus 'complete'", async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 86400;

    t.enqueue({ name: "Acme Studios" });
    t.enqueue([{ userId: "user1" }]);
    t.enqueue([{
      id: "lic-1",
      packageId: "pkg-1",
      validTo: futureExpiry,
      fileScope: null,
      productionId: null,
    }]);
    t.enqueue([]); // justExpired scrub-period sweep
    t.enqueue([
      { id: "f1", filename: "ready.usd", r2Key: "r2/f1", sizeBytes: 100, sha256: null, uploadStatus: "complete" },
      { id: "f2", filename: "pending.usd", r2Key: "r2/f2", sizeBytes: 100, sha256: null, uploadStatus: "pending" },
    ]);

    const res = await GET(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/project-grant`),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.packages[0].files).toHaveLength(1);
    expect(body.packages[0].files[0].filename).toBe("ready.usd");
  });

  it("respects fileScope when present, returning only the scoped file IDs", async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 86400;

    t.enqueue({ name: "Acme Studios" });
    t.enqueue([{ userId: "user1" }]);
    t.enqueue([{
      id: "lic-1",
      packageId: "pkg-1",
      validTo: futureExpiry,
      fileScope: JSON.stringify(["f1"]), // only file f1 is in scope
      productionId: null,
    }]);
    t.enqueue([]); // justExpired scrub-period sweep
    t.enqueue([
      { id: "f1", filename: "scoped.usd", r2Key: "r2/f1", sizeBytes: 100, sha256: null, uploadStatus: "complete" },
      { id: "f2", filename: "excluded.usd", r2Key: "r2/f2", sizeBytes: 100, sha256: null, uploadStatus: "complete" },
    ]);

    const res = await GET(
      buildRequest(`/api/bridge/render-bridge/${AGENT_ID}/project-grant`),
      makeParams(AGENT_ID)
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.packages[0].files).toHaveLength(1);
    expect(body.packages[0].files[0].filename).toBe("scoped.usd");
  });
});
