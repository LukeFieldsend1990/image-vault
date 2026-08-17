import { describe, it, expect, vi, afterEach } from "vitest";
import { parseCivitaiModelId, resolveCivitaiTarget } from "@/lib/probe/civitai";

describe("parseCivitaiModelId", () => {
  it("extracts the id from a models URL", () => {
    expect(parseCivitaiModelId("https://civitai.com/models/12345")).toBe(12345);
    expect(parseCivitaiModelId("https://civitai.com/models/678/some-slug")).toBe(678);
  });
  it("returns null for a non-Civitai url", () => {
    expect(parseCivitaiModelId("https://example.com/x")).toBeNull();
  });
});

describe("resolveCivitaiTarget", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps a model response into a probe target with hash + trigger words", async () => {
    const body = {
      id: 999,
      name: "Someone LoRA",
      type: "LORA",
      stats: { downloadCount: 4200 },
      modelVersions: [
        {
          id: 555,
          baseModel: "SDXL 1.0",
          publishedAt: "2025-06-01T00:00:00Z",
          trainedWords: ["s0me0ne"],
          files: [
            {
              primary: true,
              downloadUrl: "https://civitai.com/api/download/models/555",
              hashes: { SHA256: "a".repeat(64) },
            },
          ],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
    );

    const result = await resolveCivitaiTarget(999);
    expect(result).not.toBeNull();
    expect(result!.target.kind).toBe("civitai_lora");
    expect(result!.target.ref).toBe("999@555");
    expect(result!.target.fileSha256).toBe("a".repeat(64));
    expect(result!.target.weightsUrl).toContain("/api/download/models/555");
    expect(result!.target.meta?.trainedWords).toEqual(["s0me0ne"]);
    expect(result!.warnings).toHaveLength(0);
  });

  it("warns when no SHA-256 is published", async () => {
    const body = {
      id: 1,
      name: "No Hash LoRA",
      modelVersions: [{ id: 2, files: [{ primary: true, downloadUrl: "https://x/y" }] }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const result = await resolveCivitaiTarget("https://civitai.com/models/1");
    expect(result!.target.fileSha256).toBeNull();
    expect(result!.warnings.join(" ")).toMatch(/SHA-256/);
  });

  it("returns null on a failed fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect(await resolveCivitaiTarget(7)).toBeNull();
  });
});
