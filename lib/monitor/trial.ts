/**
 * Image Scout: trial sweeps for rep and production accounts.
 *
 * A rep or production company picks any actor from a TMDB search, optionally
 * uploads reference photos (face angles, full body, even a 3D scan), and runs
 * the real likeness-monitor pipeline against them — discovery, identity
 * verification, synthetic-media analysis, AI adjudication — without the
 * subject holding an Image Vault account. Three runs per account (admin can
 * grant more) keep the demo from becoming a free monitoring service.
 *
 * The subject has no users.id, so trials persist to their own tables
 * (trial_scans / trial_hits / trial_reference_photos) rather than the
 * talent-keyed monitor tables. Everything else is deliberately shared with
 * lib/monitor/scan.ts — discoverCandidates(talentId: null), the identity and
 * synthetic checks, the adjudicator system prompt, constrainVerdicts — so a
 * trial's verdicts mean exactly what a real sweep's do. When the actor later
 * onboards with the same TMDB id, migrateTrialHitsToTalent() copies the hits
 * into their monitor: the trial was never a dead end, it was a head start.
 */

import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  aiSettings,
  likenessHits,
  monitorScans,
  trialAllowances,
  trialHits,
  trialReferencePhotos,
  trialScans,
  users,
} from "@/lib/db/schema";
import { callAi } from "@/lib/ai/providers";
import { createNotification } from "@/lib/notifications/create";
import {
  ADJUDICATOR_SYSTEM,
  buildAdjudicationPrompt,
  constrainVerdicts,
  discoverCandidates,
  ensureMonitor,
  heuristicAdjudicate,
  parseVerdicts,
  SCAN_TIMEOUT_SECONDS,
  type AdjudicationVerdict,
} from "./scan";
import { getEnabledPlatforms } from "./platform-settings";
import { verifyCandidatesIdentity } from "./identity-check";
import { assessCandidatesSynthetic } from "./synthetic-check";
import {
  computeDetectionCoverage,
  presignR2Url,
  type DetectionCoverage,
  type R2SignEnv,
} from "./reference-set";
import { createProgressReporter, parseScanProgress } from "./progress";
import { captureThumbnail } from "./thumbnail-proxy";
import {
  detectorReadingsFrom,
  parseDetectorReadings,
  type MonitorScope,
  type TalentIdentityAnchor,
} from "./types";

type Db = ReturnType<typeof getDb>;

// ── Quota & feature gate ─────────────────────────────────────────────────────

/** Runs every rep/production account gets before an admin has to top them up. */
export const DEFAULT_TRIAL_RUN_LIMIT = 3;

/** ai_settings keys the admin panel writes. */
export const TRIAL_ENABLED_KEY = "trial_scans_enabled";
export const TRIAL_RUN_LIMIT_KEY = "trial_runs_default";

/** Reference material caps — mirrors the vault reference gallery's shape. */
export const MAX_TRIAL_PHOTOS = 12;

/** R2 prefix for uploaded trial reference material. */
export const TRIAL_REFS_R2_PREFIX = "trial-refs/";

export async function isTrialFeatureEnabled(db: Db): Promise<boolean> {
  const row = await db
    .select({ value: aiSettings.value })
    .from(aiSettings)
    .where(eq(aiSettings.key, TRIAL_ENABLED_KEY))
    .get();
  // Absent key = enabled: the feature ships on, the admin toggle turns it off.
  return row?.value !== "false";
}

async function trialRunLimitDefault(db: Db): Promise<number> {
  const row = await db
    .select({ value: aiSettings.value })
    .from(aiSettings)
    .where(eq(aiSettings.key, TRIAL_RUN_LIMIT_KEY))
    .get();
  const parsed = parseInt(row?.value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TRIAL_RUN_LIMIT;
}

export interface TrialQuota {
  /** Base allowance (admin-set default) plus this user's granted extras. */
  limit: number;
  /** Launched runs — drafts cost nothing until they run. */
  used: number;
  remaining: number;
  extraGranted: number;
}

/** Pure quota arithmetic, unit-testable without a database. */
export function computeTrialQuota(input: {
  baseLimit: number;
  extraGranted: number;
  used: number;
}): TrialQuota {
  const limit = Math.max(0, input.baseLimit) + Math.max(0, input.extraGranted);
  const used = Math.max(0, input.used);
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    extraGranted: Math.max(0, input.extraGranted),
  };
}

export async function getTrialQuota(db: Db, userId: string): Promise<TrialQuota> {
  const [baseLimit, allowance, usedRow] = await Promise.all([
    trialRunLimitDefault(db),
    db
      .select({ extraRuns: trialAllowances.extraRuns })
      .from(trialAllowances)
      .where(eq(trialAllowances.userId, userId))
      .get(),
    // Errored runs refund themselves: only sweeps that ran (or are running)
    // count. Errors aren't user-triggerable, so this can't be farmed.
    db
      .select({ n: sql<number>`count(*)` })
      .from(trialScans)
      .where(
        and(eq(trialScans.requestedBy, userId), inArray(trialScans.status, ["running", "complete"]))
      )
      .get(),
  ]);
  return computeTrialQuota({
    baseLimit,
    extraGranted: allowance?.extraRuns ?? 0,
    used: usedRow?.n ?? 0,
  });
}

// ── Drafts ───────────────────────────────────────────────────────────────────

export interface TrialSubjectInput {
  tmdbId: number;
  name: string;
  profileImageUrl: string | null;
  knownFor: Array<{ title: string; year: string; type: string }>;
  popularity: number | null;
}

/**
 * Open (or reuse) a draft trial for a subject. Idempotent per
 * (requester, tmdbId): re-picking the same actor returns the standing draft
 * with its photos intact rather than scattering uploads across duplicates.
 */
export async function createTrialDraft(
  db: Db,
  requestedBy: string,
  subject: TrialSubjectInput
): Promise<{ trialId: string; reused: boolean }> {
  const existing = await db
    .select({ id: trialScans.id })
    .from(trialScans)
    .where(
      and(
        eq(trialScans.requestedBy, requestedBy),
        eq(trialScans.tmdbId, subject.tmdbId),
        eq(trialScans.status, "draft")
      )
    )
    .get();
  if (existing) return { trialId: existing.id, reused: true };

  const id = crypto.randomUUID();
  await db.insert(trialScans).values({
    id,
    requestedBy,
    tmdbId: subject.tmdbId,
    tmdbName: subject.name,
    tmdbProfileUrl: subject.profileImageUrl,
    knownForJson: JSON.stringify(subject.knownFor ?? []),
    popularity: subject.popularity,
    status: "draft",
    createdAt: Math.floor(Date.now() / 1000),
  });
  return { trialId: id, reused: false };
}

// ── Coverage ─────────────────────────────────────────────────────────────────

export interface TrialPhotoSummary {
  faceCount: number;
  bodyCount: number;
  has3dScan: boolean;
}

export function summariseTrialPhotos(
  photos: Array<{ kind: string }>
): TrialPhotoSummary {
  return {
    faceCount: photos.filter((p) => p.kind === "face").length,
    bodyCount: photos.filter((p) => p.kind === "full_body").length,
    has3dScan: photos.some((p) => p.kind === "scan_3d"),
  };
}

/**
 * Trial detection coverage, on the same 0-100 scale and tiers the vault
 * uses so "anchored" means the same thing on both sides of the paywall. A 3D
 * scan counts as one full-body capture (it is one, plus some), and photos +
 * a 3D scan count as two capture sources — the trial analogue of the vault's
 * second-session credit. Trials never have geometry fingerprints; those only
 * exist on licensed deliveries.
 */
export function computeTrialCoverage(
  summary: TrialPhotoSummary,
  hasProfileImage: boolean
): DetectionCoverage {
  const photoSource = summary.faceCount + summary.bodyCount > 0 ? 1 : 0;
  return computeDetectionCoverage({
    faceReferenceCount: summary.faceCount,
    bodyReferenceCount: summary.bodyCount + (summary.has3dScan ? 1 : 0),
    unknownReferenceCount: 0,
    packageCount: photoSource + (summary.has3dScan ? 1 : 0),
    geometryFingerprintCount: 0,
    hasProfileImage,
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** Same lazy-timeout contract as monitor sweeps: a running trial older than
 *  the sweep timeout is dead and every read path settles it first. */
export async function timeOutStaleTrials(db: Db, requestedBy?: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const stale = and(
    eq(trialScans.status, "running"),
    lt(trialScans.startedAt, now - SCAN_TIMEOUT_SECONDS)
  );
  await db
    .update(trialScans)
    .set({
      status: "error",
      error: "Timed out — the sweep stopped reporting before it completed.",
      completedAt: now,
    })
    .where(requestedBy ? and(stale, eq(trialScans.requestedBy, requestedBy)) : stale);
}

export async function failTrial(db: Db, trialId: string, message: string): Promise<void> {
  await db
    .update(trialScans)
    .set({
      status: "error",
      error: message.slice(0, 500),
      completedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(trialScans.id, trialId));
}

// ── The sweep ────────────────────────────────────────────────────────────────

export type TrialSweepEnv = R2SignEnv & {
  AI?: Ai;
  SCANS_BUCKET?: R2Bucket;
  ANTHROPIC_API_KEY?: string;
  APIFY_TOKEN?: string;
  YOUTUBE_API_KEY?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
};

function parseKnownForTitles(json: string): string[] {
  try {
    return (JSON.parse(json) as Array<{ title?: string }>)
      .map((k) => k.title)
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Run one trial sweep. The row must already be "running" (the run route flips
 * it before enqueueing, same contract as beginLikenessScan) so the client has
 * something to poll and the quota was spent exactly once.
 */
export async function runTrialScan(
  env: TrialSweepEnv,
  db: Db,
  opts: { trialId: string }
): Promise<{ trialId: string; candidatesAnalysed: number; hitsFound: number }> {
  const now = Math.floor(Date.now() / 1000);
  const trial = await db.select().from(trialScans).where(eq(trialScans.id, opts.trialId)).get();
  if (!trial) throw new Error("Trial not found");

  const anchor: TalentIdentityAnchor = {
    fullName: trial.tmdbName,
    knownForTitles: parseKnownForTitles(trial.knownForJson),
    scanPackageCount: 0,
    geometryFingerprintCount: 0,
  };

  // Global platform toggles only — trials have no per-talent overrides.
  const enabledPlatforms = await getEnabledPlatforms(db);
  await db
    .update(trialScans)
    .set({ platformsChecked: enabledPlatforms.size })
    .where(eq(trialScans.id, trial.id));

  const progress = createProgressReporter(
    async (snapshot) => {
      await db
        .update(trialScans)
        .set({ progressJson: snapshot })
        .where(eq(trialScans.id, trial.id));
    },
    enabledPlatforms,
    `trial ${trial.id}`
  );
  progress.stage("preparing", "Anchoring identity");
  progress.note(
    `Trial sweep opened for ${anchor.fullName} — ${enabledPlatforms.size} platform${enabledPlatforms.size === 1 ? "" : "s"} in scope`
  );

  // Uploaded reference material stands in for the vault gallery. Image
  // photos feed the matcher; a 3D scan feeds the coverage tier only (trial
  // sweeps never process meshes).
  const photos = await db
    .select()
    .from(trialReferencePhotos)
    .where(eq(trialReferencePhotos.trialId, trial.id))
    .all();
  const imagePhotos = photos.filter((p) => p.kind === "face" || p.kind === "full_body");
  const coverage = computeTrialCoverage(summariseTrialPhotos(photos), !!trial.tmdbProfileUrl);
  anchor.referenceImageCount = imagePhotos.length;
  anchor.coverageTier = coverage.tier;
  try {
    await db
      .update(trialScans)
      .set({ coverageTier: coverage.tier, coverageScore: coverage.score })
      .where(eq(trialScans.id, trial.id));
  } catch (err) {
    console.warn(`[trial] coverage record failed for ${trial.id}: ${(err as Error).message}`);
  }
  if (imagePhotos.length) {
    progress.note(
      `${imagePhotos.length} uploaded reference photo${imagePhotos.length === 1 ? "" : "s"} anchoring identity checks`
    );
  }

  const scope: MonitorScope = "ai_only";
  progress.stage("discovering", "Sweeping platforms");
  const { candidates, discoveryError } = await discoverCandidates(env, db, {
    talentId: null,
    anchor,
    scope,
    allowlist: [],
    enabled: enabledPlatforms,
    scanId: trial.id,
    progress,
  });
  progress.candidates(candidates.length);
  progress.note(
    `Discovery complete — ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} queued for analysis`
  );

  if (discoveryError) {
    await failTrial(db, trial.id, discoveryError);
    throw new Error(discoveryError);
  }

  // Identity verification, anchored to whatever the requester gave us:
  // presigned uploads first, the TMDB headshot as the last-resort reference —
  // the exact fallback order the vault path uses.
  const ai = env.AI;
  if (ai && candidates.length) {
    try {
      const providerRow = await db
        .select({ value: sql<string>`${aiSettings.value}` })
        .from(aiSettings)
        .where(eq(aiSettings.key, "identity_check_provider"))
        .get();
      const provider = (providerRow?.value ?? "llava") as "llava" | "rekognition" | "both";

      let referenceImageUrls: string[] | undefined;
      let rekognitionCredentials:
        | { accessKeyId: string; secretAccessKey: string; region?: string }
        | undefined;
      if (provider !== "llava") {
        try {
          const ordered = [
            ...imagePhotos.filter((p) => p.kind === "face"),
            ...imagePhotos.filter((p) => p.kind === "full_body"),
          ].slice(0, 3);
          const urls: string[] = [];
          for (const photo of ordered) {
            const url = await presignR2Url(env, photo.r2Key);
            if (url) urls.push(url);
          }
          referenceImageUrls = urls;
        } catch (err) {
          console.warn(`[trial] reference presigning failed: ${(err as Error).message}`);
        }
        if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
          rekognitionCredentials = {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            region: env.AWS_REGION ?? "us-east-1",
          };
        }
      }

      progress.stage("verifying", "Verifying identity");
      progress.note(
        `Face verification across ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}` +
          (imagePhotos.length ? " against uploaded references" : "")
      );
      const stats = await verifyCandidatesIdentity(ai, candidates, anchor.fullName, {
        provider,
        referenceImageUrl: trial.tmdbProfileUrl ?? undefined,
        referenceImageUrls,
        rekognitionCredentials,
      });
      progress.note(
        `Identity check complete — ${stats.confirmed} likeness match${stats.confirmed === 1 ? "" : "es"} confirmed, ${stats.denied} ruled out`
      );
    } catch (err) {
      console.warn(`[trial] identity check failed: ${(err as Error).message}`);
    }
  }

  if ((ai || env.ANTHROPIC_API_KEY) && candidates.length) {
    try {
      const enabledRow = await db
        .select({ value: sql<string>`${aiSettings.value}` })
        .from(aiSettings)
        .where(eq(aiSettings.key, "synthetic_check_enabled"))
        .get();
      if (enabledRow?.value !== "false") {
        progress.note(
          `Synthetic-media analysis running on ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`
        );
        const stats = await assessCandidatesSynthetic(env, db, candidates);
        if (stats.synthetic > 0) {
          progress.note(
            `${stats.synthetic} candidate${stats.synthetic === 1 ? "" : "s"} showing AI-generation markers`
          );
        }
      }
    } catch (err) {
      console.warn(`[trial] synthetic check failed: ${(err as Error).message}`);
    }
  }

  let verdicts: AdjudicationVerdict[] | null = null;
  let aiProvider: "ai" | "heuristic" = "heuristic";
  if (candidates.length) {
    progress.stage("adjudicating", "AI adjudication");
    progress.note(
      `Adjudicator reviewing ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} with the full signal set`
    );
    const result = await callAi(env, db, {
      feature: "trial_scan",
      requiresReasoning: true,
      system: ADJUDICATOR_SYSTEM,
      userMessage: buildAdjudicationPrompt(anchor, "balanced", scope, candidates),
    });
    if (result) {
      verdicts = parseVerdicts(result.text, candidates.length);
      if (verdicts) aiProvider = "ai";
    }
  }
  if (!verdicts) verdicts = heuristicAdjudicate(candidates);
  verdicts = constrainVerdicts(verdicts, candidates, scope);

  const flagged = verdicts.filter((v) => v.flag);
  progress.stage("finalizing", "Recording results");

  // Dedupe against this trial's own prior hits (re-runs after a partial
  // failure). Deliberately NOT deduped against other trials or real monitors —
  // each trial is its own self-contained demo.
  const flaggedUrls = flagged.map((v) => candidates[v.index].contentUrl);
  const seen = new Set<string>();
  const CHUNK = 80;
  for (let i = 0; i < flaggedUrls.length; i += CHUNK) {
    const chunk = flaggedUrls.slice(i, i + CHUNK);
    const rows = await db
      .select({ contentUrl: trialHits.contentUrl })
      .from(trialHits)
      .where(and(eq(trialHits.trialId, trial.id), inArray(trialHits.contentUrl, chunk)))
      .all();
    for (const r of rows) seen.add(r.contentUrl);
  }

  let hitsFound = 0;
  const thumbnailCaptures: Array<{ hitId: string; url: string }> = [];
  for (const verdict of flagged) {
    const candidate = candidates[verdict.index];
    if (seen.has(candidate.contentUrl)) continue;
    seen.add(candidate.contentUrl);
    const hitId = crypto.randomUUID();
    await db.insert(trialHits).values({
      id: hitId,
      trialId: trial.id,
      tmdbId: trial.tmdbId,
      platform: candidate.platform,
      contentType: candidate.contentType,
      contentUrl: candidate.contentUrl,
      authorHandle: candidate.authorHandle,
      caption: candidate.caption,
      nsfw: candidate.nsfw === true,
      confidence: verdict.confidence,
      aiGeneratedLikelihood: verdict.aiGeneratedLikelihood,
      riskLevel: verdict.riskLevel,
      matchSignalsJson: JSON.stringify(verdict.matchSignals),
      aiRationale: verdict.rationale || null,
      detectorReadingsJson: JSON.stringify(detectorReadingsFrom(candidate)),
      thumbnailUrl: candidate.media?.thumbnailUrl ?? null,
      discoverySource: candidate.discoverySource
        ? `${candidate.discoverySource.mode}:${candidate.discoverySource.query}`
        : null,
      detectedAt: now,
    });
    hitsFound++;
    const thumbnailUrl = candidate.media?.thumbnailUrl;
    if (thumbnailUrl) thumbnailCaptures.push({ hitId, url: thumbnailUrl });
  }

  progress.note(
    hitsFound > 0
      ? `${hitsFound} hit${hitsFound === 1 ? "" : "s"} recorded`
      : "Sweep clean — no unauthorised use flagged"
  );

  if (env.SCANS_BUCKET && thumbnailCaptures.length) {
    progress.note(
      `Capturing evidence stills for ${thumbnailCaptures.length} hit${thumbnailCaptures.length === 1 ? "" : "s"}`
    );
    const bucket = env.SCANS_BUCKET;
    for (let i = 0; i < thumbnailCaptures.length; i += 4) {
      await Promise.all(
        thumbnailCaptures.slice(i, i + 4).map(async ({ hitId, url }) => {
          try {
            const key = await captureThumbnail(bucket, hitId, url);
            if (!key) return;
            await db.update(trialHits).set({ thumbnailKey: key }).where(eq(trialHits.id, hitId));
          } catch (err) {
            console.warn(`[trial] thumbnail capture failed for ${hitId}: ${(err as Error).message}`);
          }
        })
      );
    }
  }

  await progress.flush();

  await db
    .update(trialScans)
    .set({
      status: "complete",
      candidatesAnalysed: candidates.length,
      hitsFound,
      aiProvider,
      platformsChecked: enabledPlatforms.size,
      completedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(trialScans.id, trial.id));

  // A trial sweep completes minutes after the requester walked away; unlike
  // monitor sweeps this is their whole reason for being here, so clean and
  // hit-bearing runs both notify.
  await createNotification(db, {
    userId: trial.requestedBy,
    type: "trial_scan_complete",
    title:
      hitsFound > 0
        ? `Trial sweep: ${hitsFound} likeness hit${hitsFound === 1 ? "" : "s"} for ${trial.tmdbName}`
        : `Trial sweep complete — all clear for ${trial.tmdbName}`,
    body: `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} analysed across ${enabledPlatforms.size} platform${enabledPlatforms.size === 1 ? "" : "s"}.`,
    href: `/scout/${trial.id}`,
  });

  return { trialId: trial.id, candidatesAnalysed: candidates.length, hitsFound };
}

// ── Read model ───────────────────────────────────────────────────────────────

function hitPayload(h: typeof trialHits.$inferSelect) {
  return {
    id: h.id,
    platform: h.platform,
    contentType: h.contentType,
    contentUrl: h.contentUrl,
    authorHandle: h.authorHandle,
    caption: h.caption,
    nsfw: h.nsfw === true,
    hasThumbnail: !!(h.thumbnailKey || h.thumbnailUrl),
    confidence: h.confidence,
    aiGeneratedLikelihood: h.aiGeneratedLikelihood,
    riskLevel: h.riskLevel,
    matchSignals: safeParseArray(h.matchSignalsJson),
    aiRationale: h.aiRationale,
    detectorReadings: parseDetectorReadings(h.detectorReadingsJson),
    detectedAt: h.detectedAt,
    migrated: h.migratedHitId !== null,
  };
}

export async function listTrials(db: Db, requestedBy: string) {
  await timeOutStaleTrials(db, requestedBy);
  const rows = await db
    .select()
    .from(trialScans)
    .where(eq(trialScans.requestedBy, requestedBy))
    .orderBy(desc(trialScans.createdAt))
    .limit(50)
    .all();
  return rows.map((t) => ({
    id: t.id,
    tmdbId: t.tmdbId,
    tmdbName: t.tmdbName,
    tmdbProfileUrl: t.tmdbProfileUrl,
    status: t.status,
    hitsFound: t.hitsFound,
    candidatesAnalysed: t.candidatesAnalysed,
    coverageTier: t.coverageTier,
    converted: t.convertedTalentId !== null,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
  }));
}

/** Poll target + detail view. Scoped to the requester by the caller. */
export async function getTrialDetail(db: Db, trialId: string, requestedBy: string) {
  await timeOutStaleTrials(db, requestedBy);
  const trial = await db
    .select()
    .from(trialScans)
    .where(and(eq(trialScans.id, trialId), eq(trialScans.requestedBy, requestedBy)))
    .get();
  if (!trial) return null;

  const photos = await db
    .select()
    .from(trialReferencePhotos)
    .where(eq(trialReferencePhotos.trialId, trialId))
    .all();

  const hits =
    trial.status === "complete"
      ? await db
          .select()
          .from(trialHits)
          .where(eq(trialHits.trialId, trialId))
          .orderBy(desc(trialHits.confidence))
          .all()
      : [];

  const coverage = computeTrialCoverage(summariseTrialPhotos(photos), !!trial.tmdbProfileUrl);

  return {
    id: trial.id,
    tmdbId: trial.tmdbId,
    tmdbName: trial.tmdbName,
    tmdbProfileUrl: trial.tmdbProfileUrl,
    knownFor: safeParseKnownFor(trial.knownForJson),
    status: trial.status,
    error: trial.error,
    platformsChecked: trial.platformsChecked,
    candidatesAnalysed: trial.candidatesAnalysed,
    hitsFound: trial.hitsFound,
    aiProvider: trial.aiProvider,
    coverage,
    converted: trial.convertedTalentId !== null,
    createdAt: trial.createdAt,
    startedAt: trial.startedAt,
    completedAt: trial.completedAt,
    progress: parseScanProgress(trial.progressJson),
    photos: photos.map((p) => ({
      id: p.id,
      kind: p.kind,
      originalName: p.originalName,
      sizeBytes: p.sizeBytes,
      createdAt: p.createdAt,
    })),
    hits: hits.map(hitPayload),
  };
}

// ── Onboarding auto-populate ─────────────────────────────────────────────────

/**
 * The trial's closing promise: when the subject onboards as talent with the
 * same TMDB id, every completed trial's hits are copied into their real
 * monitor. Dedupes by content URL against hits the talent already has, marks
 * each trial converted, and tells both sides what happened. Idempotent —
 * converted trials and migrated hits are never touched twice.
 */
export async function migrateTrialHitsToTalent(
  db: Db,
  talentId: string,
  tmdbId: number
): Promise<{ trialsConverted: number; hitsMigrated: number }> {
  const trials = await db
    .select()
    .from(trialScans)
    .where(
      and(
        eq(trialScans.tmdbId, tmdbId),
        eq(trialScans.status, "complete"),
        isNull(trialScans.convertedTalentId)
      )
    )
    .all();
  if (!trials.length) return { trialsConverted: 0, hitsMigrated: 0 };

  const now = Math.floor(Date.now() / 1000);
  const trialIds = trials.map((t) => t.id);

  const pending: Array<typeof trialHits.$inferSelect> = [];
  for (let i = 0; i < trialIds.length; i += 80) {
    const rows = await db
      .select()
      .from(trialHits)
      .where(
        and(inArray(trialHits.trialId, trialIds.slice(i, i + 80)), isNull(trialHits.migratedHitId))
      )
      .all();
    pending.push(...rows);
  }

  let hitsMigrated = 0;
  if (pending.length) {
    // Which of these URLs does the talent's monitor already know about?
    const urls = [...new Set(pending.map((h) => h.contentUrl))];
    const existing = new Set<string>();
    for (let i = 0; i < urls.length; i += 80) {
      const rows = await db
        .select({ contentUrl: likenessHits.contentUrl })
        .from(likenessHits)
        .where(
          and(eq(likenessHits.talentId, talentId), inArray(likenessHits.contentUrl, urls.slice(i, i + 80)))
        )
        .all();
      for (const r of rows) existing.add(r.contentUrl);
    }

    const monitor = await ensureMonitor(db, talentId);
    // One import scan row carries the whole transfer, so the monitor page's
    // scan history shows where these hits came from.
    const importScanId = crypto.randomUUID();
    await db.insert(monitorScans).values({
      id: importScanId,
      monitorId: monitor.id,
      talentId,
      trigger: "manual",
      status: "complete",
      platformsChecked: 0,
      candidatesAnalysed: pending.length,
      hitsFound: 0, // updated below once dedupe settles the real count
      aiProvider: trials.some((t) => t.aiProvider === "ai") ? "ai" : "heuristic",
      startedAt: now,
      completedAt: now,
    });

    const migratedByUrl = new Map<string, string>();
    for (const hit of pending) {
      let newHitId = migratedByUrl.get(hit.contentUrl) ?? null;
      const duplicate = existing.has(hit.contentUrl);
      if (!duplicate && !newHitId) {
        newHitId = crypto.randomUUID();
        await db.insert(likenessHits).values({
          id: newHitId,
          scanId: importScanId,
          talentId,
          platform: hit.platform,
          contentType: hit.contentType,
          contentUrl: hit.contentUrl,
          authorHandle: hit.authorHandle,
          caption: hit.caption,
          nsfw: hit.nsfw === true,
          confidence: hit.confidence,
          aiGeneratedLikelihood: hit.aiGeneratedLikelihood,
          riskLevel: hit.riskLevel as "low" | "medium" | "high" | "critical",
          matchSignalsJson: hit.matchSignalsJson,
          aiRationale: hit.aiRationale,
          detectorReadingsJson: hit.detectorReadingsJson,
          thumbnailUrl: hit.thumbnailUrl,
          // The captured preview bytes are keyed by the trial hit's id; the
          // key string transfers as-is and keeps serving the same R2 object.
          thumbnailKey: hit.thumbnailKey,
          discoverySource: hit.discoverySource,
          accountId: null,
          status: "new",
          detectedAt: hit.detectedAt,
        });
        existing.add(hit.contentUrl);
        migratedByUrl.set(hit.contentUrl, newHitId);
        hitsMigrated++;
      }
      // "duplicate" marks a hit the talent's monitor already had — settled,
      // so the isNull() filter above never re-processes it.
      await db
        .update(trialHits)
        .set({ migratedHitId: newHitId ?? "duplicate" })
        .where(eq(trialHits.id, hit.id));
    }

    await db
      .update(monitorScans)
      .set({ hitsFound: hitsMigrated })
      .where(eq(monitorScans.id, importScanId));
  }

  for (const trial of trials) {
    await db
      .update(trialScans)
      .set({ convertedTalentId: talentId, convertedAt: now })
      .where(eq(trialScans.id, trial.id));
  }

  // Both sides hear about it: the talent finds their monitor pre-populated,
  // and each requester learns their scouting paid off.
  const subjectName = trials[0].tmdbName;
  if (hitsMigrated > 0) {
    await createNotification(db, {
      userId: talentId,
      type: "trial_hits_imported",
      title: `${hitsMigrated} likeness hit${hitsMigrated === 1 ? "" : "s"} waiting in your monitor`,
      body: "Detected during pre-onboarding trial sweeps and transferred to your account.",
      href: "/vault/monitor",
    });
  }
  for (const requesterId of [...new Set(trials.map((t) => t.requestedBy))]) {
    await createNotification(db, {
      userId: requesterId,
      type: "trial_subject_onboarded",
      title: `${subjectName} has joined Image Vault`,
      body:
        hitsMigrated > 0
          ? `Your trial results (${hitsMigrated} hit${hitsMigrated === 1 ? "" : "s"}) were transferred to their live monitor.`
          : "Your trial results were linked to their live monitor.",
      href: "/scout",
    });
  }

  return { trialsConverted: trials.length, hitsMigrated };
}

// ── Admin read model ─────────────────────────────────────────────────────────

export async function listTrialsForAdmin(db: Db) {
  await timeOutStaleTrials(db);
  const rows = await db
    .select({
      trial: trialScans,
      requesterEmail: users.email,
      requesterRole: users.role,
    })
    .from(trialScans)
    .leftJoin(users, eq(users.id, trialScans.requestedBy))
    .orderBy(desc(trialScans.createdAt))
    .limit(100)
    .all();
  return rows.map(({ trial, requesterEmail, requesterRole }) => ({
    id: trial.id,
    requestedBy: trial.requestedBy,
    requesterEmail: requesterEmail ?? "(deleted account)",
    requesterRole: requesterRole ?? null,
    tmdbId: trial.tmdbId,
    tmdbName: trial.tmdbName,
    status: trial.status,
    hitsFound: trial.hitsFound,
    candidatesAnalysed: trial.candidatesAnalysed,
    aiProvider: trial.aiProvider,
    converted: trial.convertedTalentId !== null,
    error: trial.error,
    createdAt: trial.createdAt,
    completedAt: trial.completedAt,
  }));
}

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeParseKnownFor(json: string): Array<{ title: string; year: string; type: string }> {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((k): k is { title?: unknown; year?: unknown; type?: unknown } => !!k && typeof k === "object")
      .map((k) => ({
        title: typeof k.title === "string" ? k.title : "",
        year: typeof k.year === "string" ? k.year : "",
        type: typeof k.type === "string" ? k.type : "movie",
      }))
      .filter((k) => k.title.length > 0);
  } catch {
    return [];
  }
}
