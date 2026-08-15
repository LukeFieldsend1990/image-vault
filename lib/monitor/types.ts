/**
 * Shared vocabulary for the likeness monitor.
 *
 * Everything downstream of discovery — adjudication, dedupe, persistence,
 * alerting, triage, MCP — consumes `CandidateContent`. The simulated crawler
 * (lib/monitor/candidates.ts) and the real Apify ingest (lib/monitor/ingest/)
 * both produce it, which is what lets the fake stage be swapped out without
 * touching anything else.
 *
 * The three detector signals are nullable by design: Phase 1 ships discovery
 * only, so face matching (Stage 2, Rekognition) and synthetic-media
 * classification (Stage 3, Hive) are genuinely *unavailable* rather than zero.
 * Every consumer must read null as "no reading taken" — treating it as 0 would
 * silently convert a missing detector into an exoneration.
 */

import type { HitContentType, MonitorPlatformId } from "./platforms";

export interface CandidateSignals {
  /** Cosine similarity of detected face embedding vs reference (0-1). Null until Stage 2. */
  faceEmbeddingSimilarity: number | null;
  /** Hamming distance of perceptual hash vs scan-derived references (0-64, lower = closer). Null until the pHash index exists. */
  perceptualHashDistance: number | null;
  /** Correlation vs the talent's geometry fingerprint bits (0-1). Null when no fingerprints exist, or undetectable. */
  geometryFingerprintCorrelation: number | null;
  /** Synthetic-media classifier output for the clip (0-1). Null until Stage 3. */
  syntheticMediaScore: number | null;
  postedDaysAgo: number;
  viewCount: number;
}

/** Media handles carried from discovery so Stages 2 and 3 need no re-fetch. */
export interface CandidateMedia {
  thumbnailUrl: string | null;
  videoUrl: string | null;
}

/** Which query surfaced this item — shown to talent, and the tuning signal for query weighting. */
export interface DiscoverySource {
  mode: DiscoveryMode;
  /** The hashtag, user-search string, or watched handle that produced the item. */
  query: string;
}

export type DiscoveryMode = "hashtag" | "user_search" | "account" | "simulated";

/** Author facts used to build the offender case file (monitor_accounts). */
export interface CandidateAuthorMeta {
  platformUserId: string | null;
  displayName: string | null;
  followerCount: number | null;
  verified: boolean;
}

/** Structured output of the synthetic-media check (lib/monitor/synthetic-check.ts). */
export interface SyntheticFindings {
  /** Which detector produced the reading: embedded metadata, Claude vision, or LLaVA. */
  analyst: "metadata" | "claude" | "llava";
  /** Best-guess generator family (midjourney, stable-diffusion, face-swap, ...) — Claude path only. */
  generatorFamily: string | null;
  /** Short specific observations, enforcement-grade ("blending seam at jawline"). */
  evidence: string[];
}

export interface CandidateContent {
  platform: MonitorPlatformId;
  contentType: HitContentType;
  contentUrl: string;
  authorHandle: string;
  caption: string;
  signals: CandidateSignals;
  media?: CandidateMedia;
  discoverySource?: DiscoverySource;
  authorMeta?: CandidateAuthorMeta;
  /** Hashtags parsed from the post, lowercased without the leading '#'. */
  hashtags?: string[];
  /** Set by the synthetic-media check when it produced a reading. */
  syntheticFindings?: SyntheticFindings;
  /**
   * Set when an open vigilance window — not the talent's name — supplied the
   * identity match ("cyclops+xmen", "kitconnorcyclops"). Tells the adjudicator
   * the identity evidence is role vocabulary, and tells us afterwards whether
   * windows are earning the queries they add.
   */
  vigilanceMatchTerm?: string;
}

/**
 * How far into an announcement wave a vigilance window is. Peak is the
 * fortnight after the announcement, where generation volume concentrates;
 * elevated is the long tail that follows it.
 */
export type VigilancePhase = "peak" | "elevated";

/**
 * The open announcement window steering this talent's sweep, flattened for the
 * discovery, pre-filter and adjudication stages. Built in lib/monitor/events.ts
 * from monitor_events + monitor_event_personas; the vocabulary logic that fills
 * it lives in lib/monitor/vigilance.ts.
 *
 * Absent = no window open, and every stage behaves exactly as it did before
 * windows existed.
 */
export interface VigilanceAnchor {
  eventId: string;
  eventTitle: string;
  kind: string;
  productionTitle: string | null;
  announcedAt: number;
  daysSinceAnnouncement: number;
  phase: VigilancePhase;
  /** Role names for this talent, lowercased ("cyclops", "scott summers"). */
  characterAliases: string[];
  /** Production spellings, lowercased ("x-men", "xmen"). */
  productionAliases: string[];
  /** Actor+role fusions that identify the target on their own ("kitconnorcyclops"). */
  compoundAliases: string[];
  /** Extra hashtag values this window adds to the sweep, without '#'. */
  extraHashtags: string[];
}

export interface TalentIdentityAnchor {
  fullName: string;
  knownForTitles: string[];
  scanPackageCount: number;
  geometryFingerprintCount: number;
  /** Active vault-derived reference images backing identity matching this
   *  sweep (lib/monitor/reference-set.ts). Absent = reference set not loaded. */
  referenceImageCount?: number;
  /** Detection-coverage tier computed from the reference set. */
  coverageTier?: "unanchored" | "baseline" | "anchored" | "fortified";
  /** Open announcement window focusing this sweep, if any. */
  vigilance?: VigilanceAnchor | null;
}

/**
 * What the talent is asking us to find.
 * - ai_only: synthetic misuse only — a real red-carpet clip is not a hit.
 * - all_likeness: any unauthorised likeness use is flaggable.
 * Orthogonal to `sensitivity`, which moves thresholds *within* the scope.
 */
export type MonitorScope = "ai_only" | "all_likeness";

export type MonitorCadence = "manual" | "weekly" | "daily";

/**
 * Ceiling on likeness confidence while no face matcher has run. Phase 1 can
 * read intent off a caption but cannot verify that the face is the talent's,
 * and a number above this would overstate what we actually know.
 */
export const UNVERIFIED_IDENTITY_CONFIDENCE_CAP = 60;

/** Minimum AI-generated likelihood for a hit to be recorded under `ai_only`. */
export const AI_ONLY_LIKELIHOOD_FLOOR = 60;

/** Match signal appended when the verdict was reached without a face match. */
export const IDENTITY_UNVERIFIED_SIGNAL = "identity_unverified — no face match available";
