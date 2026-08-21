import { describe, it, expect, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("no request context in tests");
  },
}));

import { renderEvidenceRecordHtml, type EvidenceRecordData } from "@/lib/monitor/evidence";

function record(overrides: Partial<EvidenceRecordData> = {}): EvidenceRecordData {
  return {
    hit: {
      id: "11111111-2222-3333-4444-555555555555",
      scanId: "scan-1",
      talentId: "talent-1",
      platform: "instagram",
      contentType: "reel",
      contentUrl: "https://instagram.com/reel/abc",
      authorHandle: "@deepfake_account",
      caption: 'AI magic <script>alert("x")</script>',
      nsfw: false,
      confidence: 92,
      aiGeneratedLikelihood: 88,
      riskLevel: "high",
      matchSignalsJson: "[]",
      aiRationale: "Face swap onto unrelated body; commercial caption.",
      detectorReadingsJson: null,
      thumbnailUrl: null,
      thumbnailKey: null,
      discoverySource: "hashtag:#talentai",
      accountId: null,
      vigilanceEventId: null,
      status: "takedown_requested",
      statusUpdatedBy: null,
      statusUpdatedAt: 1_755_000_000,
      dismissalReason: null,
      dismissalNotes: null,
      detectedAt: 1_754_000_000,
    } as EvidenceRecordData["hit"],
    talentName: "Ada Example",
    knownForTitles: ["The Example", "Another Film"],
    readings: {
      faceEmbeddingSimilarity: 0.91,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: 0.75,
      syntheticMediaScore: 0.85,
      synthetic: { analyst: "claude", generatorFamily: "face-swap", evidence: ["blending seam at jawline"] },
      vigilanceMatchTerm: null,
    },
    matchSignals: ["faceEmbeddingSimilarity 0.91", "commercial intent in caption"],
    scan: {
      id: "scan-1",
      startedAt: 1_753_999_000,
      completedAt: 1_754_000_400,
      platformsChecked: 9,
      candidatesAnalysed: 41,
      aiProvider: "ai",
      coverageTier: "anchored",
      coverageScore: 70,
    },
    account: {
      handle: "deepfake_account",
      displayName: "DF Account",
      followerCount: 12000,
      cumulativeViews: 500000,
      hitCount: 3,
      status: "reported",
    },
    takedowns: [
      { method: "email", recipient: "abuse@platform.test", sentAt: 1_754_100_000, platformStatus: "acknowledged", platformReference: "TKT-99" },
    ],
    stillDataUri: null,
    stillWithheld: false,
    generatedAt: 1_755_500_000,
    ...overrides,
  };
}

describe("renderEvidenceRecordHtml", () => {
  it("assembles the full record and escapes untrusted content", () => {
    const html = renderEvidenceRecordHtml(record());
    expect(html).toContain("Likeness Evidence Record");
    expect(html).toContain("Ada Example");
    expect(html).toContain("Instagram Reels");
    expect(html).toContain("92%");
    expect(html).toContain("blending seam at jawline");
    expect(html).toContain("abuse@platform.test");
    expect(html).toContain("anchored");
    // Caption is attacker-controlled platform text — must never reach the DOM raw.
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("prints unmeasured detectors as 'not measured', never as a value", () => {
    const html = renderEvidenceRecordHtml(record());
    // perceptualHashDistance is null in the fixture.
    expect(html).toContain("not measured");
    expect(html).toContain("No reading taken");
  });

  it("withholds the NSFW still and says so", () => {
    const html = renderEvidenceRecordHtml(record({ stillDataUri: null, stillWithheld: true }));
    expect(html).toContain("Evidence still withheld");
    expect(html).not.toContain("data:image");
  });

  it("embeds the still when one was captured", () => {
    const html = renderEvidenceRecordHtml(record({ stillDataUri: "data:image/jpeg;base64,aGVsbG8=" }));
    expect(html).toContain("data:image/jpeg;base64,aGVsbG8=");
  });

  it("states plainly when no takedown has been filed", () => {
    const html = renderEvidenceRecordHtml(record({ takedowns: [] }));
    expect(html).toContain("No takedown has been filed");
  });
});
