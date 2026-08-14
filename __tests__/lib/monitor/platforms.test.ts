import { describe, it, expect, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import { MONITOR_PLATFORMS, isMonitorPlatformId } from "@/lib/monitor/platforms";
import { getEnabledPlatforms, platformSettingKey } from "@/lib/monitor/platform-settings";
import { mapXItem, buildXQueries } from "@/lib/monitor/ingest/x";
import { mapPinterestItem, buildPinterestQueries } from "@/lib/monitor/ingest/pinterest";
import { mapSerpResult, buildSerpQueries } from "@/lib/monitor/ingest/serp";
import { mapCivitaiModel } from "@/lib/monitor/ingest/ai-platforms";
import { preFilter } from "@/lib/monitor/ingest/instagram";
import { generateCandidates } from "@/lib/monitor/candidates";
import type { DiscoverySource, TalentIdentityAnchor } from "@/lib/monitor/types";
import type { getDb } from "@/lib/db";

const HARDY: TalentIdentityAnchor = {
  fullName: "Tom Hardy",
  knownForTitles: ["Venom"],
  scanPackageCount: 1,
  geometryFingerprintCount: 0,
};

const SOURCE: DiscoverySource = { mode: "hashtag", query: "x:Tom Hardy ai" };

// ── Registry ─────────────────────────────────────────────────────────────────

describe("platform registry", () => {
  it("defaults the original three surfaces on and the newly wired ones off", () => {
    const on = MONITOR_PLATFORMS.filter((p) => p.defaultEnabled).map((p) => p.id);
    const off = MONITOR_PLATFORMS.filter((p) => !p.defaultEnabled).map((p) => p.id);
    expect(on).toEqual(["instagram", "tiktok", "youtube"]);
    expect(off).toEqual(["x", "pinterest", "google", "getty", "midjourney"]);
  });

  it("validates platform ids", () => {
    expect(isMonitorPlatformId("pinterest")).toBe(true);
    expect(isMonitorPlatformId("myspace")).toBe(false);
  });
});

// ── Settings ─────────────────────────────────────────────────────────────────

function fakeSettingsDb(rows: Array<{ key: string; value: string }>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ all: async () => rows }),
      }),
    }),
  } as unknown as ReturnType<typeof getDb>;
}

describe("getEnabledPlatforms", () => {
  it("falls back to registry defaults when no rows exist", async () => {
    const enabled = await getEnabledPlatforms(fakeSettingsDb([]));
    expect([...enabled].sort()).toEqual(["instagram", "tiktok", "youtube"]);
  });

  it("honours stored toggles over defaults, both directions", async () => {
    const enabled = await getEnabledPlatforms(
      fakeSettingsDb([
        { key: platformSettingKey("x"), value: "true" },
        { key: platformSettingKey("instagram"), value: "false" },
      ])
    );
    expect(enabled.has("x")).toBe(true);
    expect(enabled.has("instagram")).toBe(false);
    expect(enabled.has("tiktok")).toBe(true); // untouched default
  });
});

// ── X mapping ────────────────────────────────────────────────────────────────

describe("X ingest", () => {
  it("builds name-plus-intent free-text queries", () => {
    expect(buildXQueries(HARDY)).toEqual(["Tom Hardy ai", "Tom Hardy deepfake", "Tom Hardy ai video"]);
  });

  it("maps a tweet to a candidate", () => {
    const mapped = mapXItem(
      {
        url: "https://x.com/deepcast/status/1234567890",
        fullText: "Tom Hardy fully AI recast #aivideo",
        createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        viewCount: 12_000,
        author: { id: "u1", userName: "deepcast", name: "Deep Cast", followers: 900, isBlueVerified: true },
        entities: { hashtags: [{ text: "AIVideo" }] },
      },
      SOURCE
    );
    expect(mapped).not.toBeNull();
    expect(mapped!.platform).toBe("x");
    expect(mapped!.authorHandle).toBe("@deepcast");
    expect(mapped!.hashtags).toEqual(["aivideo"]);
    expect(mapped!.signals.postedDaysAgo).toBe(3);
    expect(mapped!.signals.viewCount).toBe(12_000);
    expect(mapped!.authorMeta?.verified).toBe(true);
    // Detector signals are unmeasured, never zero.
    expect(mapped!.signals.faceEmbeddingSimilarity).toBeNull();
  });

  it("drops tweets with no author or url", () => {
    expect(mapXItem({ text: "orphan" }, SOURCE)).toBeNull();
  });
});

// ── Pinterest mapping ────────────────────────────────────────────────────────

describe("Pinterest ingest", () => {
  it("builds still-image intent queries", () => {
    expect(buildPinterestQueries(HARDY)).toEqual([
      "Tom Hardy ai",
      "Tom Hardy ai art",
      "Tom Hardy midjourney",
    ]);
  });

  it("maps a pin, deriving the URL from the pin id when absent", () => {
    const mapped = mapPinterestItem(
      {
        id: "9876543210",
        title: "Tom Hardy AI portrait pack",
        description: "midjourney set",
        repin_count: 40,
        images: { orig: { url: "https://i.pinimg.com/orig/abc.jpg" } },
        pinner: { id: "p1", username: "aiportraits", full_name: "AI Portraits", follower_count: 5000 },
      },
      SOURCE
    );
    expect(mapped).not.toBeNull();
    expect(mapped!.platform).toBe("pinterest");
    expect(mapped!.contentUrl).toBe("https://www.pinterest.com/pin/9876543210/");
    expect(mapped!.media?.thumbnailUrl).toBe("https://i.pinimg.com/orig/abc.jpg");
    expect(mapped!.signals.viewCount).toBe(40);
  });
});

// ── SERP mapping ─────────────────────────────────────────────────────────────

describe("SERP ingest (google + getty)", () => {
  it("scopes getty queries to the stock domains", () => {
    const queries = buildSerpQueries("getty", HARDY);
    expect(queries.some((q) => q.startsWith("site:gettyimages.com"))).toBe(true);
    expect(queries.some((q) => q.startsWith("site:shutterstock.com"))).toBe(true);
  });

  it("uses the hosting domain as the offender handle", () => {
    const mapped = mapSerpResult(
      "google",
      {
        title: "Tom Hardy AI generated wallpapers",
        url: "https://www.ai-wallpapers.example.net/tom-hardy",
        description: "Fully AI generated portraits",
      },
      SOURCE
    );
    expect(mapped).not.toBeNull();
    expect(mapped!.platform).toBe("google");
    expect(mapped!.contentType).toBe("image");
    expect(mapped!.authorHandle).toBe("@ai-wallpapers.example.net");
  });

  it("drops results with unparseable URLs", () => {
    expect(mapSerpResult("getty", { title: "x", url: "not a url" }, SOURCE)).toBeNull();
  });
});

// ── Civitai mapping ──────────────────────────────────────────────────────────

describe("AI-platform ingest (Civitai)", () => {
  const model = {
    id: 4242,
    name: "Tom Hardy likeness",
    description: "<p>LoRA trained on <b>Tom Hardy</b> stills</p>",
    type: "LORA",
    tags: ["Celebrity", "lora"],
    creator: { username: "modelmaker" },
    stats: { downloadCount: 1200 },
    modelVersions: [{ createdAt: new Date().toISOString(), images: [{ url: "https://image.civitai.com/x.jpg" }] }],
  };

  it("maps a model to a candidate with downloads as reach and stripped HTML", () => {
    const source: DiscoverySource = { mode: "user_search", query: "civitai:Tom Hardy" };
    const mapped = mapCivitaiModel(model, source);
    expect(mapped).not.toBeNull();
    expect(mapped!.platform).toBe("midjourney");
    expect(mapped!.contentUrl).toBe("https://civitai.com/models/4242");
    expect(mapped!.signals.viewCount).toBe(1200);
    expect(mapped!.caption).not.toContain("<p>");
    expect(mapped!.caption).toContain("LoRA trained on Tom Hardy stills");
  });

  it("produces candidates that survive the ai_only pre-filter", () => {
    // The whole point of this surface is likeness models; the caption must
    // carry enough declared AI intent to clear the recall gate on its own.
    const source: DiscoverySource = { mode: "user_search", query: "civitai:Tom Hardy" };
    const mapped = mapCivitaiModel(model, source)!;
    const { kept } = preFilter([mapped], { anchor: HARDY, scope: "ai_only" });
    expect(kept).toHaveLength(1);
  });
});

// ── Simulator ────────────────────────────────────────────────────────────────

describe("simulated crawler platform pool", () => {
  it("only emits candidates on the platforms it was given", () => {
    for (let i = 0; i < 10; i++) {
      const candidates = generateCandidates(HARDY, ["getty", "midjourney"]);
      for (const c of candidates) {
        expect(["getty", "midjourney"]).toContain(c.platform);
      }
    }
  });
});
