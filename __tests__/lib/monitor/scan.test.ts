import { describe, it, expect, vi } from "vitest";

// scan.ts transitively imports edge-only modules (db, email); pure-function
// tests never execute those paths
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import { generateCandidates, type CandidateContent, type TalentIdentityAnchor } from "@/lib/monitor/candidates";
import { parseVerdicts, heuristicAdjudicate } from "@/lib/monitor/scan";
import { MONITOR_PLATFORMS, platformName } from "@/lib/monitor/platforms";

const ANCHOR: TalentIdentityAnchor = {
  fullName: "Ava Sterling",
  knownForTitles: ["Midnight Harbour", "The Long Field"],
  scanPackageCount: 2,
  geometryFingerprintCount: 12,
};

function suspiciousCandidate(): CandidateContent {
  return {
    platform: "instagram",
    contentType: "reel",
    contentUrl: "https://www.instagram.com/reel/AbC123xYz09/",
    authorHandle: "@ai.face.forge",
    caption: "Training our new likeness model on Ava Sterling — link in bio",
    signals: {
      faceEmbeddingSimilarity: 0.93,
      perceptualHashDistance: 6,
      geometryFingerprintCorrelation: 0.88,
      syntheticMediaScore: 0.95,
      postedDaysAgo: 1,
      viewCount: 120_000,
    },
  };
}

function benignCandidate(): CandidateContent {
  return {
    platform: "youtube",
    contentType: "short",
    contentUrl: "https://www.youtube.com/shorts/qWeRtY12345",
    authorHandle: "@filmfan.archive",
    caption: "Best scenes from Midnight Harbour",
    signals: {
      faceEmbeddingSimilarity: 0.51,
      perceptualHashDistance: 31,
      geometryFingerprintCorrelation: 0.12,
      syntheticMediaScore: 0.08,
      postedDaysAgo: 9,
      viewCount: 4_200,
    },
  };
}

describe("generateCandidates", () => {
  it("emits candidates from short-form platforms with detector signals", () => {
    const candidates = generateCandidates(ANCHOR);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    const platformIds = new Set(MONITOR_PLATFORMS.map((p) => p.id));
    for (const c of candidates) {
      expect(platformIds.has(c.platform)).toBe(true);
      expect(c.contentUrl).toMatch(/^https:\/\//);
      expect(c.signals.faceEmbeddingSimilarity).toBeGreaterThanOrEqual(0);
      expect(c.signals.faceEmbeddingSimilarity).toBeLessThanOrEqual(1);
      // Talent has fingerprints, so correlation must be populated
      expect(c.signals.geometryFingerprintCorrelation).not.toBeNull();
    }
  });

  it("omits fingerprint correlation when the talent has none", () => {
    const candidates = generateCandidates({ ...ANCHOR, geometryFingerprintCount: 0 });
    for (const c of candidates) {
      expect(c.signals.geometryFingerprintCorrelation).toBeNull();
    }
  });
});

describe("heuristicAdjudicate", () => {
  it("flags a strong synthetic likeness match and clears benign fan content", () => {
    const verdicts = heuristicAdjudicate([suspiciousCandidate(), benignCandidate()]);
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0].flag).toBe(true);
    expect(verdicts[0].confidence).toBeGreaterThanOrEqual(70);
    // Fingerprint correlation = scan-data provenance = critical
    expect(verdicts[0].riskLevel).toBe("critical");
    expect(verdicts[0].matchSignals.length).toBeGreaterThan(0);
    expect(verdicts[1].flag).toBe(false);
  });

  it("does not flag a likeness match without synthetic-media evidence", () => {
    const archival = suspiciousCandidate();
    archival.signals.syntheticMediaScore = 0.1;
    const [verdict] = heuristicAdjudicate([archival]);
    expect(verdict.flag).toBe(false);
  });
});

describe("parseVerdicts", () => {
  const valid = JSON.stringify([
    {
      index: 0,
      flag: true,
      confidence: 91,
      aiGeneratedLikelihood: 96,
      riskLevel: "high",
      matchSignals: ["Face embedding similarity 0.93"],
      rationale: "Commercial model-training claim over a strong biometric match.",
    },
    { index: 1, flag: false, confidence: 22, aiGeneratedLikelihood: 5, riskLevel: "low", matchSignals: [], rationale: "Archival fan clip." },
  ]);

  it("parses a plain JSON array", () => {
    const verdicts = parseVerdicts(valid, 2);
    expect(verdicts).toHaveLength(2);
    expect(verdicts![0].flag).toBe(true);
    expect(verdicts![0].riskLevel).toBe("high");
  });

  it("parses fenced output with leading prose", () => {
    const verdicts = parseVerdicts("Here are my verdicts:\n```json\n" + valid + "\n```", 2);
    expect(verdicts).toHaveLength(2);
  });

  it("drops out-of-range indexes and clamps scores", () => {
    const messy = JSON.stringify([
      { index: 7, flag: true, confidence: 90 },
      { index: 0, flag: true, confidence: 400, aiGeneratedLikelihood: -5, riskLevel: "apocalyptic" },
    ]);
    const verdicts = parseVerdicts(messy, 2);
    expect(verdicts).toHaveLength(1);
    expect(verdicts![0].confidence).toBe(100);
    expect(verdicts![0].aiGeneratedLikelihood).toBe(0);
    expect(verdicts![0].riskLevel).toBe("medium");
  });

  it("returns null for garbage", () => {
    expect(parseVerdicts("I could not adjudicate.", 2)).toBeNull();
    expect(parseVerdicts("{}", 2)).toBeNull();
  });
});

describe("platformName", () => {
  it("resolves registry ids and passes through unknowns", () => {
    expect(platformName("instagram")).toBe("Instagram Reels");
    expect(platformName("myspace")).toBe("myspace");
  });
});
