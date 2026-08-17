import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import {
  buildDiscoveryPlan,
  hasAiIntent,
  hashtagsHaveAiIntent,
  nameSlug,
  nameVariants,
  queryImpliesAiIntent,
  rosterHashtagQueries,
} from "@/lib/monitor/ingest/queries";
import { mapInstagramItem, preFilter } from "@/lib/monitor/ingest/instagram";
import { runActor, ApifyError, apifyToken } from "@/lib/monitor/ingest/apify";
import { heuristicAdjudicate, constrainVerdicts } from "@/lib/monitor/scan";
import type { CandidateContent, TalentIdentityAnchor, DiscoverySource } from "@/lib/monitor/types";
import {
  AI_ONLY_LIKELIHOOD_FLOOR,
  UNVERIFIED_IDENTITY_CONFIDENCE_CAP,
} from "@/lib/monitor/types";

const HARDY: TalentIdentityAnchor = {
  fullName: "Tom Hardy",
  knownForTitles: ["Venom", "Mad Max: Fury Road"],
  scanPackageCount: 2,
  geometryFingerprintCount: 0,
};

const SOURCE: DiscoverySource = { mode: "hashtag", query: "tomhardyai" };

function candidate(over: Partial<CandidateContent> = {}): CandidateContent {
  return {
    platform: "instagram",
    contentType: "reel",
    contentUrl: "https://www.instagram.com/reel/AAA111/",
    authorHandle: "@ai.face.forge",
    caption: "Tom Hardy fully AI generated recast",
    hashtags: ["aivideo"],
    discoverySource: SOURCE,
    signals: {
      faceEmbeddingSimilarity: null,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: null,
      postedDaysAgo: 2,
      viewCount: 50_000,
    },
    ...over,
  };
}

// ── Query planning ───────────────────────────────────────────────────────────

describe("query planning", () => {
  it("slugs and varies a name the way handles actually spell it", () => {
    expect(nameSlug("Tom Hardy")).toBe("tomhardy");
    expect(nameSlug("Léa Seydoux")).toBe("leaseydoux");
    const variants = nameVariants("Tom Hardy");
    expect(variants).toContain("tom hardy");
    expect(variants).toContain("tomhardy");
    expect(variants).toContain("tom.hardy");
    expect(variants).toContain("tom_hardy");
  });

  it("sweeps the bare name tag, where the content actually is", () => {
    // Verified live: #tomhardyai was empty; a synthetic Venom trailer sat under
    // #tomhardy. These accounts tag for reach, and the reach is under the
    // actor's name — so the name tag leads and AI intent is decided downstream.
    const plan = buildDiscoveryPlan(HARDY);
    const hashtags = plan.filter((q) => q.mode === "hashtag").map((q) => q.value);
    expect(hashtags[0]).toBe("tomhardy");
    expect(hashtags).toContain("tomhardyai");
    // Title tags follow the same rule — the observed post was #venom4, not #venom4ai.
    expect(hashtags).toContain("venom");
  });

  it("no longer plans user_search, which returns nothing through Apify", () => {
    expect(buildDiscoveryPlan(HARDY).some((q) => q.mode === "user_search")).toBe(false);
  });

  it("puts watched accounts first and never drops them to the budget", () => {
    const watched = Array.from({ length: 12 }, (_, i) => `@offender${i}`);
    const plan = buildDiscoveryPlan(HARDY, { watchedHandles: watched, maxQueries: 4 });
    expect(plan).toHaveLength(12);
    expect(plan.every((q) => q.mode === "account")).toBe(true);
    expect(plan[0].value).toBe("offender0");
  });

  it("caps total queries so per-sweep spend stays predictable", () => {
    const plan = buildDiscoveryPlan(HARDY, { maxQueries: 3 });
    expect(plan).toHaveLength(3);
  });

  it("keeps roster hashtags out of the per-talent plan", () => {
    const perTalent = buildDiscoveryPlan(HARDY).map((q) => q.value);
    expect(perTalent).not.toContain("deepfake");
    expect(rosterHashtagQueries().map((q) => q.value)).toContain("deepfake");
  });
});

// ── AI intent ────────────────────────────────────────────────────────────────

describe("AI intent detection", () => {
  it("reads intent out of prose", () => {
    expect(hasAiIntent("Made with AI, obviously")).toBe(true);
    expect(hasAiIntent("full deepfake recast")).toBe(true);
    expect(hasAiIntent("Throwback to the premiere ❤️")).toBe(false);
  });

  it("catches synthetic content that never says 'AI'", () => {
    // Live example: a Venom trailer using Tom Hardy's likeness, captioned
    // "FAN MADE CONCEPT TRAILER" with no AI word anywhere in it.
    expect(hasAiIntent("Venom 4: King in Black | Tom Hardy | Concept Trailer")).toBe(true);
    expect(hasAiIntent("Watch this Venom 4: Knull Awaken - FAN MADE CONCEPT TRAILER")).toBe(true);
    expect(hasAiIntent("What if Tom Hardy played Batman")).toBe(true);
    // …without dragging in genuine promotion.
    expect(hasAiIntent("Official trailer out now, in cinemas December")).toBe(false);
  });

  it("reads intent out of concatenated hashtags", () => {
    // The primary discovery surface — a word-boundary regex misses these.
    expect(hashtagsHaveAiIntent(["tomhardyai"])).toBe(true);
    expect(hashtagsHaveAiIntent(["aivideo"])).toBe(true);
    expect(hashtagsHaveAiIntent(["tomhardydeepfake"])).toBe(true);
    expect(hashtagsHaveAiIntent(["redcarpet", "premiere"])).toBe(false);
  });

  it("does not fire on 'ai' buried inside ordinary words", () => {
    expect(hashtagsHaveAiIntent(["portrait"])).toBe(false);
    expect(hashtagsHaveAiIntent(["hair"])).toBe(false);
    expect(hashtagsHaveAiIntent(["chairs"])).toBe(false);
  });

  it("treats the discovering query as intent evidence", () => {
    expect(queryImpliesAiIntent("tomhardydeepfake")).toBe(true);
    expect(queryImpliesAiIntent("tomhardy")).toBe(false);
  });
});

// ── Mapping ──────────────────────────────────────────────────────────────────

describe("Apify item mapping", () => {
  it("carries media handles through for the detector stages", () => {
    const mapped = mapInstagramItem(
      {
        url: "https://www.instagram.com/reel/XYZ/",
        ownerUsername: "ai.face.forge",
        ownerId: "9912",
        ownerFullName: "AI Face Forge",
        followersCount: 40_000,
        caption: "Tom Hardy AI",
        hashtags: ["#TomHardyAI"],
        displayUrl: "https://cdn/thumb.jpg",
        videoUrl: "https://cdn/clip.mp4",
        videoPlayCount: 120_000,
        timestamp: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      },
      SOURCE
    )!;

    expect(mapped.media?.thumbnailUrl).toBe("https://cdn/thumb.jpg");
    expect(mapped.media?.videoUrl).toBe("https://cdn/clip.mp4");
    expect(mapped.authorHandle).toBe("@ai.face.forge");
    expect(mapped.hashtags).toEqual(["tomhardyai"]);
    expect(mapped.signals.viewCount).toBe(120_000);
    expect(mapped.signals.postedDaysAgo).toBe(3);
  });

  it("labels content type from the post type, not by assuming everything is a reel", () => {
    // Live hashtag sweeps return Sidecar (carousel) and Image posts alongside
    // video; calling a still a reel would misstate what was actually found.
    const video = mapInstagramItem({ url: "https://x/", ownerUsername: "a", type: "Video" }, SOURCE)!;
    const carousel = mapInstagramItem({ url: "https://y/", ownerUsername: "a", type: "Sidecar" }, SOURCE)!;
    const image = mapInstagramItem({ url: "https://z/", ownerUsername: "a", type: "Image" }, SOURCE)!;
    expect(video.contentType).toBe("reel");
    expect(carousel.contentType).toBe("post");
    expect(image.contentType).toBe("post");
  });

  it("drops Apify's error sentinel items", () => {
    // An empty or private hashtag yields a diagnostic object rather than posts.
    // It has a url but no owner, so it must not become a candidate.
    const sentinel = mapInstagramItem(
      { url: "https://www.instagram.com/explore/tags/tomhardyai" } as never,
      SOURCE
    );
    expect(sentinel).toBeNull();
  });

  it("lowercases hashtags, which arrive mixed-case from Apify", () => {
    const mapped = mapInstagramItem(
      { url: "https://x/", ownerUsername: "a", hashtags: ["AIVideo", "TimeFreeze"] },
      SOURCE
    )!;
    expect(mapped.hashtags).toEqual(["aivideo", "timefreeze"]);
  });

  it("falls back to likesCount for reach when no view count is present", () => {
    // Non-video posts carry no videoPlayCount; likes are the only reach signal.
    const mapped = mapInstagramItem(
      { url: "https://x/", ownerUsername: "a", type: "Sidecar", likesCount: 4200 },
      SOURCE
    )!;
    expect(mapped.signals.viewCount).toBe(4200);
  });

  it("reports unmeasured detectors as null, never as zero", () => {
    const mapped = mapInstagramItem({ url: "https://x/", ownerUsername: "a" }, SOURCE)!;
    expect(mapped.signals.faceEmbeddingSimilarity).toBeNull();
    expect(mapped.signals.syntheticMediaScore).toBeNull();
    expect(mapped.signals.perceptualHashDistance).toBeNull();
  });

  it("drops items with no author or no URL", () => {
    expect(mapInstagramItem({ ownerUsername: "a" }, SOURCE)).toBeNull();
    expect(mapInstagramItem({ url: "https://x/" }, SOURCE)).toBeNull();
  });
});

// ── Pre-filter ───────────────────────────────────────────────────────────────

describe("pre-filter", () => {
  const base = { anchor: HARDY, scope: "ai_only" as const };

  it("never flags an allowlisted account, even on a perfect match", () => {
    const c = candidate({ authorHandle: "@tomhardy", caption: "Tom Hardy AI behind the scenes" });
    const { kept, dropped } = preFilter([c], { ...base, allowlist: ["@tomhardy"] });
    expect(kept).toHaveLength(0);
    expect(dropped.allowlisted).toBe(1);
  });

  it("drops items that never mention the talent", () => {
    const c = candidate({ caption: "Some other actor, fully AI", hashtags: ["aivideo"], authorHandle: "@x" });
    const { kept, dropped } = preFilter([c], base);
    expect(kept).toHaveLength(0);
    expect(dropped.no_name_match).toBe(1);
  });

  it("drops genuine footage under ai_only but keeps it under all_likeness", () => {
    const real = candidate({
      caption: "Tom Hardy at the premiere last night",
      hashtags: ["redcarpet"],
      authorHandle: "@cinema.moments",
      discoverySource: { mode: "account", query: "cinema.moments" },
    });
    expect(preFilter([real], base).kept).toHaveLength(0);
    expect(preFilter([real], { ...base, scope: "all_likeness" }).kept).toHaveLength(1);
  });

  it("keeps a bare-caption post that the discovering hashtag already marked as AI", () => {
    const c = candidate({
      caption: "Tom Hardy",
      hashtags: [],
      discoverySource: { mode: "hashtag", query: "tomhardydeepfake" },
    });
    expect(preFilter([c], base).kept).toHaveLength(1);
  });

  it("drops already-seen and within-sweep duplicates before they cost anything", () => {
    const c = candidate();
    const dup = candidate();
    const seenOne = candidate({ contentUrl: "https://www.instagram.com/reel/SEEN/" });
    const { kept, dropped } = preFilter([c, dup, seenOne], {
      ...base,
      seenUrls: new Set(["https://www.instagram.com/reel/SEEN/"]),
    });
    expect(kept).toHaveLength(1);
    expect(dropped.duplicate).toBe(1);
    expect(dropped.seen_before).toBe(1);
  });
});

// ── Apify client ─────────────────────────────────────────────────────────────

describe("Apify client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts, polls and returns dataset items", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("/runs?")) {
          return new Response(JSON.stringify({ data: { id: "r1", defaultDatasetId: "d1", status: "RUNNING" } }));
        }
        if (url.includes("/actor-runs/r1?")) {
          return new Response(JSON.stringify({ data: { status: "SUCCEEDED" } }));
        }
        return new Response(JSON.stringify([{ ownerUsername: "a" }]));
      })
    );

    const run = await runActor({ token: "t", actorId: "apify~x", input: {}, pollIntervalMs: 1 });
    expect(run.items).toEqual([{ ownerUsername: "a" }]);
    expect(run.runId).toBe("r1");
    expect(calls.some((c) => c.includes("/datasets/d1/items"))).toBe(true);
  });

  it("reports Apify's own billed cost so the spend gate sums real money", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/runs?")) {
          return new Response(
            JSON.stringify({
              data: { id: "r1", defaultDatasetId: "d1", status: "RUNNING", usageTotalUsd: 0 },
            })
          );
        }
        if (url.includes("/actor-runs/r1?")) {
          return new Response(JSON.stringify({ data: { status: "SUCCEEDED", usageTotalUsd: 0.37 } }));
        }
        return new Response(JSON.stringify([]));
      })
    );

    const run = await runActor({ token: "t", actorId: "apify~x", input: {}, pollIntervalMs: 1 });
    expect(run.costUsd).toBe(0.37);
  });

  it("carries the run id on failure, because a started run has already spent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/runs?")
          ? new Response(
              JSON.stringify({ data: { id: "r9", defaultDatasetId: "d9", status: "FAILED", usageTotalUsd: 0.12 } })
            )
          : new Response(JSON.stringify({ data: { status: "FAILED", usageTotalUsd: 0.12 } }))
      )
    );

    await expect(
      runActor({ token: "t", actorId: "apify~x", input: {}, pollIntervalMs: 1 })
    ).rejects.toMatchObject({ runId: "r9", costUsd: 0.12 });
  });

  it("surfaces auth failures distinctly so the caller can stop retrying", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    await expect(runActor({ token: "bad", actorId: "apify~x", input: {} })).rejects.toMatchObject({
      reason: "auth",
    });
  });

  it("surfaces an exhausted-credits refusal distinctly so the sweep stops discovery", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("payment required", { status: 402 })));
    await expect(runActor({ token: "t", actorId: "apify~x", input: {} })).rejects.toMatchObject({
      reason: "credits",
    });
  });

  it("fails the run rather than silently returning nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/runs?")
          ? new Response(JSON.stringify({ data: { id: "r1", defaultDatasetId: "d1", status: "FAILED" } }))
          : new Response(JSON.stringify({ data: { status: "FAILED" } }))
      )
    );
    await expect(
      runActor({ token: "t", actorId: "apify~x", input: {}, pollIntervalMs: 1 })
    ).rejects.toBeInstanceOf(ApifyError);
  });

  it("reports no token rather than sending an empty one", () => {
    expect(apifyToken({ APIFY_TOKEN: "  " })).toBeNull();
    expect(apifyToken({ APIFY_TOKEN: "abc" })).toBe("abc");
  });
});

// ── Degraded adjudication ────────────────────────────────────────────────────

describe("adjudication with detectors unavailable", () => {
  it("flags declared-AI content on discovery signals alone", () => {
    const [verdict] = heuristicAdjudicate([candidate()]);
    expect(verdict.flag).toBe(true);
    expect(verdict.aiGeneratedLikelihood).toBeGreaterThanOrEqual(AI_ONLY_LIKELIHOOD_FLOOR);
  });

  it("does not treat a null synthetic score as an exoneration", () => {
    // Both have no classifier reading; only one declares AI. A null read as 0
    // would clear them both identically.
    const declared = heuristicAdjudicate([candidate()])[0];
    const silent = heuristicAdjudicate([
      candidate({
        caption: "Tom Hardy interview",
        hashtags: [],
        authorHandle: "@cinema.moments",
        discoverySource: undefined,
      }),
    ])[0];
    expect(declared.flag).toBe(true);
    expect(silent.flag).toBe(false);
  });

  it("caps confidence and says so when no face match was taken", () => {
    const c = candidate();
    const constrained = constrainVerdicts(
      [
        {
          index: 0,
          flag: true,
          confidence: 95,
          aiGeneratedLikelihood: 90,
          riskLevel: "high",
          matchSignals: [],
          rationale: "",
        },
      ],
      [c],
      "ai_only"
    );
    expect(constrained[0].confidence).toBe(UNVERIFIED_IDENTITY_CONFIDENCE_CAP);
    expect(constrained[0].matchSignals.join(" ")).toContain("identity_unverified");
  });

  it("leaves confidence alone once a face reading exists", () => {
    const c = candidate({
      signals: { ...candidate().signals, faceEmbeddingSimilarity: 0.91, syntheticMediaScore: 0.88 },
    });
    const constrained = constrainVerdicts(
      [
        {
          index: 0,
          flag: true,
          confidence: 95,
          aiGeneratedLikelihood: 90,
          riskLevel: "high",
          matchSignals: [],
          rationale: "",
        },
      ],
      [c],
      "ai_only"
    );
    expect(constrained[0].confidence).toBe(95);
  });

  it("withholds the flag under ai_only when AI likelihood is below the floor", () => {
    const c = candidate();
    const verdict = {
      index: 0,
      flag: true,
      confidence: 55,
      aiGeneratedLikelihood: 30,
      riskLevel: "medium" as const,
      matchSignals: [],
      rationale: "",
    };
    expect(constrainVerdicts([verdict], [c], "ai_only")[0].flag).toBe(false);
    expect(constrainVerdicts([verdict], [c], "all_likeness")[0].flag).toBe(true);
  });
});
