/**
 * Synthetic crawler for the likeness monitor demo.
 *
 * Production would ingest platform firehoses / hashtag crawls and run real
 * perceptual-hash + face-embedding + geometry-fingerprint detectors at the
 * edge. This module simulates that stage: it emits candidate content items
 * carrying detector signals, which the AI adjudicator (lib/monitor/scan.ts)
 * then judges against the talent's identity anchors. The adjudication,
 * persistence, alerting and triage layers downstream are all real.
 */

import type { HitContentType, MonitorPlatformId } from "./platforms";

export interface CandidateSignals {
  /** Cosine similarity of detected face embedding vs onboarding reference (0-1). */
  faceEmbeddingSimilarity: number;
  /** Hamming distance of perceptual hash vs scan-derived reference hashes (0-64, lower = closer). */
  perceptualHashDistance: number;
  /** Correlation vs the talent's geometry fingerprint bits (0-1); null when no fingerprints exist. */
  geometryFingerprintCorrelation: number | null;
  /** Output of the synthetic-media classifier on the clip itself (0-1). */
  syntheticMediaScore: number;
  postedDaysAgo: number;
  viewCount: number;
}

export interface CandidateContent {
  platform: MonitorPlatformId;
  contentType: HitContentType;
  contentUrl: string;
  authorHandle: string;
  caption: string;
  signals: CandidateSignals;
}

export interface TalentIdentityAnchor {
  fullName: string;
  knownForTitles: string[];
  scanPackageCount: number;
  geometryFingerprintCount: number;
}

// ── Random helpers ───────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function intBetween(min: number, max: number): number {
  return Math.floor(between(min, max + 1));
}

function randomId(len: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function randomDigits(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 10);
  return out;
}

// ── Content templates ────────────────────────────────────────────────────────

const SUSPICIOUS_HANDLES = [
  "ai.face.forge", "deepcast.studio", "reel.synth", "neuralscreen",
  "fanedits.ai", "cine.morph", "castswap.fx", "dreamframe.gen",
  "syntheticscenes", "faceloom.ai", "moviemash.gen", "recast.daily",
];

const BENIGN_HANDLES = [
  "filmfan.archive", "cinema.moments", "bts.collector", "redcarpet.daily",
  "classicscenes", "premiere.clips",
];

const SUSPICIOUS_CAPTIONS = [
  (name: string, title: string) => `What if ${name} starred in a sequel to ${title}? Full AI recast 🔥 #aivideo #deepfake`,
  (name: string, title: string) => `${name} but every line is AI generated… we're cooked 😭 (made with our new face model) #${title.replace(/\W/g, "").toLowerCase()}`,
  (name: string) => `POV: ${name} endorses our trading app 📈 (AI, obviously… or is it) #ad`,
  (name: string) => `Training our new likeness model on ${name} — results are INSANE. Link in bio to generate your own scenes.`,
  (name: string, title: string) => `Deleted scene from ${title} that never existed… AI is getting scary good. ${name} 4K upscale.`,
  (name: string) => `${name} sings your requests — comment below! (voice + face fully synthetic)`,
];

const BENIGN_CAPTIONS = [
  (name: string, title: string) => `Throwback to ${name}'s premiere for ${title} ❤️ #tbt`,
  (name: string, title: string) => `Best scenes from ${title} — what a performance by ${name}`,
  (name: string) => `${name} interview compilation, pure class`,
];

function contentUrlFor(platform: MonitorPlatformId, handle: string): { url: string; type: HitContentType } {
  switch (platform) {
    case "instagram":
      return { url: `https://www.instagram.com/reel/${randomId(11)}/`, type: "reel" };
    case "tiktok":
      return { url: `https://www.tiktok.com/@${handle}/video/${randomDigits(19)}`, type: "video" };
    case "youtube":
      return { url: `https://www.youtube.com/shorts/${randomId(11)}`, type: "short" };
    default:
      return { url: `https://x.com/${handle}/status/${randomDigits(19)}`, type: "post" };
  }
}

const VIDEO_PLATFORMS: MonitorPlatformId[] = ["instagram", "tiktok", "youtube", "x"];

// ── Generator ────────────────────────────────────────────────────────────────

function makeCandidate(anchor: TalentIdentityAnchor, suspicious: boolean): CandidateContent {
  const platform = pick(VIDEO_PLATFORMS);
  const handle = suspicious ? pick(SUSPICIOUS_HANDLES) : pick(BENIGN_HANDLES);
  const { url, type } = contentUrlFor(platform, handle);
  const title = anchor.knownForTitles.length ? pick(anchor.knownForTitles) : "their latest film";
  const caption = suspicious
    ? pick(SUSPICIOUS_CAPTIONS)(anchor.fullName, title)
    : pick(BENIGN_CAPTIONS)(anchor.fullName, title);

  const hasFingerprints = anchor.geometryFingerprintCount > 0;
  const signals: CandidateSignals = suspicious
    ? {
        faceEmbeddingSimilarity: Number(between(0.83, 0.97).toFixed(3)),
        perceptualHashDistance: intBetween(4, 14),
        geometryFingerprintCorrelation: hasFingerprints ? Number(between(0.72, 0.95).toFixed(3)) : null,
        syntheticMediaScore: Number(between(0.78, 0.99).toFixed(3)),
        postedDaysAgo: intBetween(0, 6),
        viewCount: intBetween(4_000, 2_400_000),
      }
    : {
        faceEmbeddingSimilarity: Number(between(0.35, 0.68).toFixed(3)),
        perceptualHashDistance: intBetween(22, 44),
        geometryFingerprintCorrelation: hasFingerprints ? Number(between(0.05, 0.35).toFixed(3)) : null,
        syntheticMediaScore: Number(between(0.02, 0.3).toFixed(3)),
        postedDaysAgo: intBetween(1, 30),
        viewCount: intBetween(500, 90_000),
      };

  return { platform, contentType: type, contentUrl: url, authorHandle: `@${handle}`, caption, signals };
}

/**
 * Emit this sweep's candidate set: a few benign lookalike/fan items the
 * adjudicator should clear, plus 0-3 planted synthetic-likeness items
 * (~1 in 4 sweeps comes back fully clean).
 */
export function generateCandidates(anchor: TalentIdentityAnchor): CandidateContent[] {
  const suspiciousCount = Math.random() < 0.25 ? 0 : intBetween(1, 3);
  const benignCount = intBetween(2, 4);
  const candidates = [
    ...Array.from({ length: suspiciousCount }, () => makeCandidate(anchor, true)),
    ...Array.from({ length: benignCount }, () => makeCandidate(anchor, false)),
  ];
  // Shuffle so planted items aren't positionally identifiable by the adjudicator
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates;
}
