import { describe, it, expect, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import { normaliseHandle, parseHandleList } from "@/lib/monitor/ingest/follows";

describe("handle normalisation", () => {
  it("accepts the forms a person actually pastes", () => {
    expect(normaliseHandle("leakingai")).toBe("leakingai");
    expect(normaliseHandle("@reveal.aii")).toBe("reveal.aii");
    expect(normaliseHandle("  @Leaking_AI  ")).toBe("leaking_ai");
    expect(normaliseHandle("https://www.instagram.com/ultimatestudiosofficial/")).toBe(
      "ultimatestudiosofficial"
    );
    expect(normaliseHandle("instagram.com/reveal.aii")).toBe("reveal.aii");
  });

  it("rejects a pasted post link rather than watching an account called 'reel'", () => {
    expect(normaliseHandle("https://www.instagram.com/reel/DYV7w3lC5Gv/")).toBeNull();
    expect(normaliseHandle("https://www.instagram.com/p/ABC123/")).toBeNull();
  });

  it("rejects junk", () => {
    expect(normaliseHandle("")).toBeNull();
    expect(normaliseHandle("   ")).toBeNull();
    expect(normaliseHandle("not a handle!")).toBeNull();
    expect(normaliseHandle("a".repeat(31))).toBeNull();
  });
});

describe("bulk paste parsing", () => {
  it("handles newlines, commas and semicolons together", () => {
    const { handles } = parseHandleList("leakingai\n@reveal.aii, ultimatestudiosofficial; foo.bar");
    expect(handles).toEqual(["leakingai", "reveal.aii", "ultimatestudiosofficial", "foo.bar"]);
  });

  it("dedupes across spellings of the same account", () => {
    const { handles } = parseHandleList(
      "leakingai\n@leakingai\nhttps://www.instagram.com/leakingai/\nLEAKINGAI"
    );
    expect(handles).toEqual(["leakingai"]);
  });

  it("reports what it could not parse instead of dropping it silently", () => {
    const { handles, rejected } = parseHandleList("leakingai\nnot a handle!\n@reveal.aii");
    expect(handles).toEqual(["leakingai", "reveal.aii"]);
    expect(rejected).toEqual(["not a handle!"]);
  });

  it("survives an empty paste", () => {
    expect(parseHandleList("")).toEqual({ handles: [], rejected: [] });
    expect(parseHandleList("\n\n  \n")).toEqual({ handles: [], rejected: [] });
  });
});
