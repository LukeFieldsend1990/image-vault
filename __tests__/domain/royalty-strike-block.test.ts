import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { createTestEnv, buildRequest, parseJson } from "../helpers/mocks";

const t = createTestEnv();

// Royalty source auth + rate limit are mocked so we can drive the strike path.
const royaltyAuth = {
  sourceId: "src-1",
  licenceId: "L1",
  talentId: "talent-1",
  displayName: "Pixel Forge VFX",
  unitType: "per_frame" as const,
  unitRatePence: 50,
};

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: t.getCloudflareContext }));
vi.mock("@/lib/db", () => ({ getDb: t.getDb, getKv: t.getKv }));
vi.mock("@/lib/auth/requireRoyaltySource", () => ({
  requireRoyaltySource: vi.fn(async () => royaltyAuth),
  isRoyaltySourceError: (r: unknown): r is NextResponse => r instanceof NextResponse,
}));
vi.mock("@/lib/auth/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true })),
}));

const usageRoute = await import("@/app/api/royalties/usage/route");

describe("POST /api/royalties/usage — 39.G strike enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns 423 and meters nothing while a covering strike is active", async () => {
    t.enqueue({ status: "APPROVED", licenceType: "ai_avatar", permitAiTraining: false }); // licence validation
    t.enqueue({ organisationId: null, productionId: null }); // findCoveringStrike licence load
    t.enqueue({ id: "s1", scope: "global", reason: "SAG-AFTRA strike" }); // active strike
    t.enqueue(null); // appendEvent tip for use.blocked_by_strike

    const res = await usageRoute.POST(
      buildRequest("/api/royalties/usage", { body: { externalRef: "gen_1", units: 240, eventType: "per_frame" } }),
    );

    expect(res.status).toBe(423);
    const json = await parseJson(res);
    expect(json.strike.scope).toBe("global");

    // No usage_events row was written (the only insert is the blocked-attempt event).
    const meteredInsert = t.insertedRows.map((r) => r.values as any).find((v) => v.grossPence !== undefined);
    expect(meteredInsert).toBeUndefined();
    const blockedEvent = t.insertedRows.map((r) => r.values as any).find((v) => v.eventType === "use.blocked_by_strike");
    expect(blockedEvent).toBeTruthy();
  });
});
