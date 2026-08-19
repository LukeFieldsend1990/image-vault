import { describe, it, expect, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import { MONITOR_PLATFORMS, isMonitorPlatformId } from "@/lib/monitor/platforms";
import {
  applyPlatformOverrides,
  getEnabledPlatforms,
  parsePlatformOverrides,
  platformSettingKey,
} from "@/lib/monitor/platform-settings";
import { mapXItem, buildXQueries } from "@/lib/monitor/ingest/x";
import { mapPinterestItem, buildPinterestQueries } from "@/lib/monitor/ingest/pinterest";
import { mapRedditItem, buildRedditQueries } from "@/lib/monitor/ingest/reddit";
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
    expect(off).toEqual(["x", "pinterest", "reddit", "google", "getty", "midjourney"]);
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

// ── Per-talent overrides ─────────────────────────────────────────────────────

describe("per-talent platform overrides", () => {
  it("parses only known platforms with boolean values, tolerating junk", () => {
    expect(parsePlatformOverrides('{"x":true,"instagram":false,"myspace":true,"tiktok":"yes"}')).toEqual({
      x: true,
      instagram: false,
    });
    expect(parsePlatformOverrides("not json")).toEqual({});
    expect(parsePlatformOverrides(null)).toEqual({});
    expect(parsePlatformOverrides("[1,2]")).toEqual({});
  });

  it("forces platforms on or off over the global set, inheriting where absent", () => {
    const global = new Set<"instagram" | "tiktok" | "youtube">(["instagram", "tiktok", "youtube"]);
    const effective = applyPlatformOverrides(global as never, { x: true, instagram: false });
    expect(effective.has("x")).toBe(true); // forced on despite global off
    expect(effective.has("instagram")).toBe(false); // forced off despite global on
    expect(effective.has("tiktok")).toBe(true); // inherited
    // The input set is not mutated.
    expect(global.has("instagram")).toBe(true);
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

// ── Reddit mapping ───────────────────────────────────────────────────────────

describe("Reddit ingest", () => {
  it("builds name-plus-intent free-text queries", () => {
    expect(buildRedditQueries(HARDY)).toEqual([
      "Tom Hardy ai",
      "Tom Hardy deepfake",
      "Tom Hardy ai generated",
    ]);
  });

  it("maps a post, leading the caption with the subreddit", () => {
    const mapped = mapRedditItem(
      {
        id: "t3_abc1234",
        url: "https://www.reddit.com/r/aivideo/comments/abc1234/tom_hardy_ai_recast/",
        username: "u/deepcaster",
        userId: "t2_xyz",
        title: "Tom Hardy fully AI recast",
        communityName: "r/aivideo",
        parsedCommunityName: "aivideo",
        body: "Made with our new face model",
        createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        upVotes: 340,
        thumbnailUrl: "https://b.thumbs.redditmedia.com/abc.jpg",
        dataType: "post",
      },
      SOURCE
    );
    expect(mapped).not.toBeNull();
    expect(mapped!.platform).toBe("reddit");
    expect(mapped!.authorHandle).toBe("@deepcaster");
    expect(mapped!.caption.startsWith("[r/aivideo]")).toBe(true);
    expect(mapped!.hashtags).toEqual(["aivideo"]);
    expect(mapped!.media?.thumbnailUrl).toBe("https://b.thumbs.redditmedia.com/abc.jpg");
    expect(mapped!.signals.postedDaysAgo).toBe(2);
    expect(mapped!.signals.viewCount).toBe(340);
    // Detector signals are unmeasured, never zero.
    expect(mapped!.signals.faceEmbeddingSimilarity).toBeNull();
  });

  it("drops comments, ads and items with no author or url", () => {
    const base = { url: "https://www.reddit.com/r/a/comments/x/", username: "someone" };
    expect(mapRedditItem({ ...base, dataType: "comment" }, SOURCE)).toBeNull();
    expect(mapRedditItem({ ...base, isAd: true }, SOURCE)).toBeNull();
    expect(mapRedditItem({ title: "orphan" }, SOURCE)).toBeNull();
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
