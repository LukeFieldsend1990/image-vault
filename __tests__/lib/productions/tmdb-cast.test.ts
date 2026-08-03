import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import { mockChainDb } from "../../helpers/mocks";
import { fetchTmdbCastWithMatches } from "@/lib/productions/tmdb-cast";

const CREDITS = {
  cast: [
    { id: 505710, name: "Zendaya", character: "Tashi Duncan", profile_path: "/z.jpg", order: 0 },
  ],
};

/** Records every TMDB URL fetched; replies per a path → response map. */
function stubFetch(handler: (url: string) => { status: number; body?: unknown }) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const { status, body } = handler(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {},
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

describe("fetchTmdbCastWithMatches media type", () => {
  beforeEach(() => {
    process.env.TMDB_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TMDB_API_KEY;
  });

  it("uses the picked title's media type, not the production's type", async () => {
    // A production typed tv_series that the user points at a film. Before the
    // fix this hit /tv/<film id>/credits and 404'd into an empty cast list.
    const { db, enqueue } = mockChainDb();
    enqueue([]); // talent profile lookup
    const calls = stubFetch((url) =>
      url.includes("/movie/937287/credits") ? { status: 200, body: CREDITS } : { status: 404 }
    );

    const result = await fetchTmdbCastWithMatches(
      db as never,
      { type: "tv_series", tmdbId: null },
      937287,
      "movie"
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/movie/937287/credits");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cast[0].name).toBe("Zendaya");
  });

  it("falls back to the other endpoint on 404 when no media type is given", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue([]);
    const calls = stubFetch((url) =>
      url.includes("/movie/937287/credits") ? { status: 200, body: CREDITS } : { status: 404 }
    );

    const result = await fetchTmdbCastWithMatches(db as never, { type: "tv_series", tmdbId: 937287 });

    expect(calls[0]).toContain("/tv/937287/credits");
    expect(calls[1]).toContain("/movie/937287/credits");
    expect(result.ok).toBe(true);
  });

  it("reports a 404 as an error rather than an empty cast list", async () => {
    const { db } = mockChainDb();
    stubFetch(() => ({ status: 404 }));

    const result = await fetchTmdbCastWithMatches(db as never, { type: "film", tmdbId: 1 }, null, "movie");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toContain("search for the correct title");
    }
  });
});
