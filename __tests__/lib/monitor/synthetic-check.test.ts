import { describe, it, expect, vi } from "vitest";

// synthetic-check imports providers.ts which transitively touches edge-only
// modules; the mock mirrors scan.test.ts.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import {
  ARTIFACT_SCORE,
  AUTHENTIC_SCORE,
  CLAUDE_ARTIFACT_CAP,
  CLAUDE_ARTIFACT_FLOOR,
  MARKER_SCORE,
  checkSyntheticMedia,
  parseArtifactAnalysis,
  parseSyntheticVerdict,
  scanProvenanceMarkers,
  scoreArtifactAnalysis,
} from "@/lib/monitor/synthetic-check";
import { sniffImageMediaType } from "@/lib/ai/providers";

function bytesWith(text: string): Uint8Array {
  // Marker embedded mid-buffer surrounded by binary noise, like real
  // metadata sits between compressed segments.
  const noiseA = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x42, 0x89, 0x50]);
  const noiseB = new Uint8Array([0x00, 0x01, 0xfe, 0xca, 0xff, 0xd9]);
  const marker = new TextEncoder().encode(text);
  const out = new Uint8Array(noiseA.length + marker.length + noiseB.length);
  out.set(noiseA, 0);
  out.set(marker, noiseA.length);
  out.set(noiseB, noiseA.length + marker.length);
  return out;
}

describe("scanProvenanceMarkers", () => {
  it("finds the IPTC trained-algorithmic-media source type, case-insensitively", () => {
    const scan = scanProvenanceMarkers(
      bytesWith('<Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/TrainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType>')
    );
    expect(scan.aiDeclared).toContain("trainedalgorithmicmedia");
  });

  it("finds generator signatures in XMP software fields", () => {
    expect(scanProvenanceMarkers(bytesWith('xmp:CreatorTool="Midjourney v6.1"')).aiDeclared).toContain("midjourney");
    expect(scanProvenanceMarkers(bytesWith("Software: Stable Diffusion XL")).aiDeclared).toContain("stable diffusion");
  });

  it("records C2PA manifests as provenance, never as AI evidence", () => {
    const scan = scanProvenanceMarkers(bytesWith('{"@context":"https://c2pa.org/manifest","claim":"urn:c2pa:claim"}'));
    expect(scan.provenance).toEqual(expect.arrayContaining(["urn:c2pa", "c2pa.org"]));
    expect(scan.aiDeclared).toEqual([]);
  });

  it("finds nothing in plain binary noise", () => {
    const scan = scanProvenanceMarkers(new Uint8Array([0xff, 0xd8, 0x12, 0x34, 0xab, 0xcd, 0xff, 0xd9]));
    expect(scan.aiDeclared).toEqual([]);
    expect(scan.provenance).toEqual([]);
  });
});

describe("parseSyntheticVerdict", () => {
  it("maps the model's one-word answers", () => {
    expect(parseSyntheticVerdict("Synthetic")).toBe("synthetic");
    expect(parseSyntheticVerdict("authentic")).toBe("authentic");
    expect(parseSyntheticVerdict("unsure")).toBe("unsure");
  });

  it("scans hedged answers for the meaningful word", () => {
    expect(parseSyntheticVerdict("The image appears to be AI-generated.")).toBe("synthetic");
    expect(parseSyntheticVerdict("This looks like a genuine photograph.")).toBe("authentic");
  });

  it("refuses to commit on noise", () => {
    expect(parseSyntheticVerdict("I cannot determine that")).toBe("unsure");
    expect(parseSyntheticVerdict("")).toBe("unsure");
  });
});

describe("checkSyntheticMedia", () => {
  const aiNeverCalled = {
    run: async () => {
      throw new Error("vision model should not have been called");
    },
  } as unknown as Ai;

  const aiAnswering = (answer: string) =>
    ({ run: async () => ({ description: answer }) }) as unknown as Ai;

  it("short-circuits on declared-AI metadata without spending a vision call", async () => {
    const result = await checkSyntheticMedia(aiNeverCalled, bytesWith("trainedAlgorithmicMedia"));
    expect(result).toEqual({
      score: MARKER_SCORE,
      verdict: "synthetic",
      evidence: "provenance_marker",
      detail: "trainedalgorithmicmedia",
    });
  });

  it("does not short-circuit on a bare C2PA manifest — cameras embed those too", async () => {
    const result = await checkSyntheticMedia(aiAnswering("authentic"), bytesWith("urn:c2pa:manifest"));
    expect(result?.evidence).toBe("artifact_check");
    expect(result?.score).toBe(AUTHENTIC_SCORE);
  });

  it("caps artifact verdicts below the marker score", async () => {
    const result = await checkSyntheticMedia(aiAnswering("synthetic"), bytesWith("no markers here"));
    expect(result?.score).toBe(ARTIFACT_SCORE);
    expect(ARTIFACT_SCORE).toBeLessThan(MARKER_SCORE);
  });

  it("maps 'unsure' to a null score — a reading that declines to commit", async () => {
    const result = await checkSyntheticMedia(aiAnswering("unsure"), bytesWith("no markers here"));
    expect(result?.verdict).toBe("unsure");
    expect(result?.score).toBeNull();
  });

  it("returns null when the vision model errors and no markers exist", async () => {
    const result = await checkSyntheticMedia(aiNeverCalled, bytesWith("no markers here"));
    expect(result).toBeNull();
  });
});

describe("parseArtifactAnalysis", () => {
  it("parses a clean JSON analysis", () => {
    const analysis = parseArtifactAnalysis(
      '{"verdict":"synthetic","confidence":85,"generatorFamily":"face-swap","evidence":["blending seam at jawline","face lighting inconsistent with scene"],"filteredReal":false}'
    );
    expect(analysis).toEqual({
      verdict: "synthetic",
      confidence: 85,
      generatorFamily: "face-swap",
      evidence: ["blending seam at jawline", "face lighting inconsistent with scene"],
      filteredReal: false,
    });
  });

  it("tolerates markdown fences and normalises unknown generator families", () => {
    const analysis = parseArtifactAnalysis(
      '```json\n{"verdict":"synthetic","confidence":70,"generatorFamily":"SomeNewModel","evidence":[],"filteredReal":false}\n```'
    );
    expect(analysis?.verdict).toBe("synthetic");
    expect(analysis?.generatorFamily).toBeNull();
  });

  it("rejects garbage and unknown verdicts", () => {
    expect(parseArtifactAnalysis("I think it looks fake")).toBeNull();
    expect(parseArtifactAnalysis('{"verdict":"probably","confidence":50}')).toBeNull();
  });

  it("clamps out-of-range confidence and defaults a missing one to 50", () => {
    expect(parseArtifactAnalysis('{"verdict":"synthetic","confidence":250}')?.confidence).toBe(100);
    expect(parseArtifactAnalysis('{"verdict":"unsure"}')?.confidence).toBe(50);
  });
});

describe("scoreArtifactAnalysis", () => {
  const base = { generatorFamily: null, evidence: [], filteredReal: false };

  it("scales synthetic verdicts with confidence inside the floor-cap band", () => {
    expect(scoreArtifactAnalysis({ ...base, verdict: "synthetic", confidence: 0 })).toBe(CLAUDE_ARTIFACT_FLOOR);
    expect(scoreArtifactAnalysis({ ...base, verdict: "synthetic", confidence: 100 })).toBe(CLAUDE_ARTIFACT_CAP);
    const mid = scoreArtifactAnalysis({ ...base, verdict: "synthetic", confidence: 50 });
    expect(mid).toBeGreaterThan(CLAUDE_ARTIFACT_FLOOR);
    expect(mid).toBeLessThan(CLAUDE_ARTIFACT_CAP);
  });

  it("keeps the Claude cap below a metadata declaration", () => {
    expect(CLAUDE_ARTIFACT_CAP).toBeLessThan(MARKER_SCORE);
  });

  it("collapses 'synthetic but plausibly filtered' to null — the false-positive guard", () => {
    expect(
      scoreArtifactAnalysis({ ...base, verdict: "synthetic", confidence: 90, filteredReal: true })
    ).toBeNull();
  });

  it("maps authentic and unsure as the LLaVA path does", () => {
    expect(scoreArtifactAnalysis({ ...base, verdict: "authentic", confidence: 80 })).toBe(AUTHENTIC_SCORE);
    expect(scoreArtifactAnalysis({ ...base, verdict: "unsure", confidence: 50 })).toBeNull();
  });
});

describe("sniffImageMediaType", () => {
  it("identifies the containers social thumbnails arrive in", () => {
    expect(sniffImageMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImageMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe("image/png");
    expect(
      sniffImageMediaType(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
      )
    ).toBe("image/webp");
  });

  it("refuses to guess on unknown bytes", () => {
    expect(sniffImageMediaType(new TextEncoder().encode("<html>not an image</html>"))).toBeNull();
    expect(sniffImageMediaType(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
