import { describe, it, expect } from "vitest";

import { detectorReadingsFrom, parseDetectorReadings, type CandidateContent } from "@/lib/monitor/types";

function candidate(overrides: Partial<CandidateContent> = {}): CandidateContent {
  return {
    platform: "instagram",
    contentType: "reel",
    contentUrl: "https://instagram.com/reel/abc",
    authorHandle: "@deepfake_account",
    caption: "amazing new video",
    signals: {
      faceEmbeddingSimilarity: 0.91,
      perceptualHashDistance: 12,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: 0.85,
      postedDaysAgo: 2,
      viewCount: 5000,
    },
    ...overrides,
  };
}

describe("detectorReadingsFrom → parseDetectorReadings round trip", () => {
  it("freezes measured values and keeps nulls as nulls", () => {
    const parsed = parseDetectorReadings(JSON.stringify(detectorReadingsFrom(candidate())));
    expect(parsed).toEqual({
      faceEmbeddingSimilarity: 0.91,
      perceptualHashDistance: 12,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: 0.85,
      synthetic: null,
      vigilanceMatchTerm: null,
    });
  });

  it("carries the synthetic analyst's findings and the vigilance term", () => {
    const parsed = parseDetectorReadings(
      JSON.stringify(
        detectorReadingsFrom(
          candidate({
            syntheticFindings: {
              analyst: "claude",
              generatorFamily: "stable-diffusion",
              evidence: ["blending seam at jawline", "static earring under head turn"],
            },
            vigilanceMatchTerm: "kitconnorcyclops",
          })
        )
      )
    );
    expect(parsed!.synthetic).toEqual({
      analyst: "claude",
      generatorFamily: "stable-diffusion",
      evidence: ["blending seam at jawline", "static earring under head turn"],
    });
    expect(parsed!.vigilanceMatchTerm).toBe("kitconnorcyclops");
  });
});

describe("parseDetectorReadings on untrusted stored data", () => {
  it("returns null for pre-column hits and malformed json", () => {
    expect(parseDetectorReadings(null)).toBeNull();
    expect(parseDetectorReadings(undefined)).toBeNull();
    expect(parseDetectorReadings("not json")).toBeNull();
    expect(parseDetectorReadings("[]")).toBeNull();
  });

  it("coerces non-numeric readings to null rather than inventing a measurement", () => {
    const parsed = parseDetectorReadings(
      JSON.stringify({
        faceEmbeddingSimilarity: "0.9",
        perceptualHashDistance: NaN,
        geometryFingerprintCorrelation: 0.75,
        syntheticMediaScore: null,
        synthetic: { generatorFamily: "x" }, // no analyst → dropped whole
      })
    );
    expect(parsed).toEqual({
      faceEmbeddingSimilarity: null,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: 0.75,
      syntheticMediaScore: null,
      synthetic: null,
      vigilanceMatchTerm: null,
    });
  });
});
