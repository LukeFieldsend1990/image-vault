import { describe, it, expect, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import {
  hashtagActorInput,
  profileActorInput,
  searchActorInput,
} from "@/lib/monitor/ingest/instagram";
import { tiktokProfileInput, tiktokSearchInput, TIKTOK_ACTOR } from "@/lib/monitor/ingest/tiktok";
import { ACTORS } from "@/lib/monitor/ingest/apify";
import { ACTOR_ID_PATTERN, clampResultsPerQuery } from "@/lib/monitor/ingest/actor-settings";
import { mapRedditApiItem } from "@/lib/monitor/ingest/reddit-api";
import { mapSerpResult } from "@/lib/monitor/ingest/serp";
import type { DiscoverySource } from "@/lib/monitor/types";

describe("actor input builders", () => {
  // The default actors' shapes are pinned exactly: clearing an override must
  // restore today's behaviour byte for byte.
  it("default hashtag actor gets today's exact input shape", () => {
    expect(hashtagActorInput(ACTORS.hashtag, "tomhardy", 100)).toEqual({
      hashtags: ["tomhardy"],
      resultsLimit: 100,
    });
  });

  it("default search actor gets today's exact input shape", () => {
    expect(searchActorInput(ACTORS.search, "tom hardy", 50)).toEqual({
      search: "tom hardy",
      searchType: "user",
      resultsLimit: 50,
    });
  });

  it("default profile actor gets today's exact input shape, with and without newerThan", () => {
    expect(profileActorInput(ACTORS.profile, "ai.face.forge", 24)).toEqual({
      directUrls: ["https://www.instagram.com/ai.face.forge/"],
      resultsType: "posts",
      resultsLimit: 24,
    });
    expect(profileActorInput(ACTORS.profile, "ai.face.forge", 24, "2026-08-01")).toEqual({
      directUrls: ["https://www.instagram.com/ai.face.forge/"],
      resultsType: "posts",
      resultsLimit: 24,
      onlyPostsNewerThan: "2026-08-01",
    });
  });

  it("default tiktok actor gets today's exact search and profile shapes", () => {
    expect(tiktokSearchInput(TIKTOK_ACTOR, "tom hardy ai", 50)).toEqual({
      searchQueries: ["tom hardy ai"],
      resultsPerPage: 50,
      shouldDownloadVideos: false,
    });
    expect(tiktokProfileInput(TIKTOK_ACTOR, "aiforge", 6)).toEqual({
      profiles: ["aiforge"],
      resultsPerPage: 6,
      shouldDownloadVideos: false,
    });
  });

  it("an overridden actor gets a superset input carrying the alias keys", () => {
    const hashtag = hashtagActorInput("vendor~cheap-hashtag", "tomhardy", 40);
    expect(hashtag).toMatchObject({
      hashtags: ["tomhardy"],
      hashtag: "tomhardy",
      resultsLimit: 40,
      maxItems: 40,
      limit: 40,
    });

    const profile = profileActorInput("vendor~cheap-profile", "aiforge", 24, "2026-08-01");
    expect(profile).toMatchObject({
      directUrls: ["https://www.instagram.com/aiforge/"],
      usernames: ["aiforge"],
      resultsLimit: 24,
      maxItems: 24,
      onlyPostsNewerThan: "2026-08-01",
    });

    const tiktok = tiktokSearchInput("vendor~cheap-tiktok", "tom hardy ai", 40);
    expect(tiktok).toMatchObject({
      searchQueries: ["tom hardy ai"],
      keywords: ["tom hardy ai"],
      search: "tom hardy ai",
      resultsPerPage: 40,
      maxItems: 40,
      shouldDownloadVideos: false,
    });
  });
});

describe("actor settings validation", () => {
  it("accepts owner~name actor ids and rejects everything else", () => {
    expect(ACTOR_ID_PATTERN.test("apify~instagram-hashtag-scraper")).toBe(true);
    expect(ACTOR_ID_PATTERN.test("some_vendor~actor.v2")).toBe(true);
    expect(ACTOR_ID_PATTERN.test("apify/instagram-scraper")).toBe(false);
    expect(ACTOR_ID_PATTERN.test("not an actor")).toBe(false);
    expect(ACTOR_ID_PATTERN.test("")).toBe(false);
  });

  it("clamps results-per-query to 10–200 and rejects non-numbers", () => {
    expect(clampResultsPerQuery(50)).toBe(50);
    expect(clampResultsPerQuery("60")).toBe(60);
    expect(clampResultsPerQuery(5)).toBe(10);
    expect(clampResultsPerQuery(9999)).toBe(200);
    expect(clampResultsPerQuery("abc")).toBeUndefined();
    expect(clampResultsPerQuery(null)).toBeUndefined();
    expect(clampResultsPerQuery(undefined)).toBeUndefined();
  });
});

const SOURCE: DiscoverySource = { mode: "hashtag", query: "reddit:Tom Hardy ai" };

describe("Reddit API item mapping", () => {
  const post = {
    permalink: "/r/SFWdeepfakes/comments/abc/tom_hardy_ai_recast/",
    author: "faceforger",
    author_fullname: "t2_abc123",
    subreddit: "SFWdeepfakes",
    title: "Tom Hardy AI recast",
    selftext: "Made with midjourney",
    created_utc: Math.floor(Date.now() / 1000) - 3 * 86_400,
    ups: 42,
    over_18: true,
    thumbnail: "nsfw",
    preview: { images: [{ source: { url: "https://preview.redd.it/x.jpg?width=640&amp;s=abc" } }] },
  };

  it("maps a full post into the same shape the Apify mapper produces", () => {
    const c = mapRedditApiItem(post, SOURCE);
    expect(c).not.toBeNull();
    expect(c!.platform).toBe("reddit");
    expect(c!.contentType).toBe("post");
    expect(c!.contentUrl).toBe("https://www.reddit.com/r/SFWdeepfakes/comments/abc/tom_hardy_ai_recast/");
    expect(c!.authorHandle).toBe("@faceforger");
    // Subreddit leads the caption — it is often the strongest intent evidence.
    expect(c!.caption.startsWith("[r/sfwdeepfakes]")).toBe(true);
    expect(c!.caption).toContain("Tom Hardy AI recast");
    expect(c!.hashtags).toEqual(["sfwdeepfakes"]);
    expect(c!.nsfw).toBe(true);
    expect(c!.signals.postedDaysAgo).toBe(3);
    expect(c!.signals.viewCount).toBe(42);
    // Detector slots stay null — null is "not measured", never zero.
    expect(c!.signals.faceEmbeddingSimilarity).toBeNull();
    expect(c!.signals.syntheticMediaScore).toBeNull();
  });

  it("prefers the preview image and decodes HTML entities in its URL", () => {
    const c = mapRedditApiItem(post, SOURCE);
    expect(c!.media?.thumbnailUrl).toBe("https://preview.redd.it/x.jpg?width=640&s=abc");
  });

  it("treats sentinel thumbnail values as no-thumbnail", () => {
    for (const sentinel of ["self", "default", "nsfw", "spoiler", ""]) {
      const c = mapRedditApiItem({ ...post, preview: undefined, thumbnail: sentinel }, SOURCE);
      expect(c!.media?.thumbnailUrl).toBeNull();
    }
    const real = mapRedditApiItem(
      { ...post, preview: undefined, thumbnail: "https://b.thumbs.redditmedia.com/x.jpg" },
      SOURCE
    );
    expect(real!.media?.thumbnailUrl).toBe("https://b.thumbs.redditmedia.com/x.jpg");
  });

  it("drops posts with no author or deleted authors", () => {
    expect(mapRedditApiItem({ ...post, author: undefined }, SOURCE)).toBeNull();
    expect(mapRedditApiItem({ ...post, author: "[deleted]" }, SOURCE)).toBeNull();
  });

  it("drops posts with no resolvable URL", () => {
    expect(mapRedditApiItem({ ...post, permalink: undefined, url: undefined }, SOURCE)).toBeNull();
  });
});

describe("Brave SERP transport invariance", () => {
  it("Brave results map through mapSerpResult to the same candidate shape as the actor path", () => {
    // discoverBraveSerp feeds Brave's web.results straight into mapSerpResult,
    // so the shared mapper is the whole contract.
    const c = mapSerpResult(
      "getty",
      {
        title: "Tom Hardy AI editorial stock",
        url: "https://www.gettyimages.com/photos/tom-hardy-ai",
        description: "AI generated portraits",
      },
      { mode: "hashtag", query: "getty:site:gettyimages.com \"Tom Hardy\" ai" }
    );
    expect(c).not.toBeNull();
    expect(c!.platform).toBe("getty");
    expect(c!.authorHandle).toBe("@gettyimages.com");
    expect(c!.discoverySource?.query).toBe('getty:site:gettyimages.com "Tom Hardy" ai');
  });
});
