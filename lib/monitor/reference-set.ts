/**
 * Vault-anchored reference set: the talent's own scan packages as detection
 * ground truth.
 *
 * This is the asset nobody else has. Every third-party deepfake detector
 * matches candidate content against public photos — press shots, social
 * avatars, whatever a crawler found. Image Vault holds studio-grade,
 * consent-verified captures: multi-angle face scans and full-body scans. This
 * module turns those files into the reference gallery the identity matcher
 * compares candidates against, which is what lets the monitor tell a
 * doppelgänger from a derived likeness when a single press photo cannot.
 *
 * Design constraints:
 *  - Bytes never leave the vault. Rows index R2 keys; a sweep presigns them
 *    for minutes, feeds them to the matcher, and the URLs expire.
 *  - Sync is cheap and idempotent (DB-only), so the sweep path can call it
 *    lazily — a package uploaded yesterday strengthens today's sweep with no
 *    extra pipeline stage.
 *  - Coverage scoring is pure and deterministic, because the talent-facing
 *    number ("detection coverage") must be explainable: it moves when they
 *    add scans, and the UI tells them exactly which scan to add next.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { AwsClient } from "aws4fetch";
import type { getDb } from "@/lib/db";
import { monitorReferenceImages, scanFiles, scanPackages } from "@/lib/db/schema";

type Db = ReturnType<typeof getDb>;

/** Cap on stored references per talent — enough angles to cover pose
 *  variation without presigning half a scan package every sweep. */
export const MAX_REFERENCES = 12;

/** How many reference sources a single sweep actually matches against. */
export const MAX_MATCH_SOURCES = 3;

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

/** Sidecar imagery that ships inside scan packages but is useless (or
 *  misleading) as a face reference. */
const NON_REFERENCE_HINTS =
  /(texture|uv|normal|albedo|roughness|displacement|specular|wireframe|mesh|topolog|calib|chart|colou?rcheck|macbeth|slate|thumb)/i;

const FACE_HINTS = /(face|head|portrait|front|neutral|expression|closeup|close-up|facs)/i;
const BODY_HINTS = /(body|full[-_ ]?body|figure|stance|a[-_ ]?pose|t[-_ ]?pose|standing|silhouette)/i;

export type ReferenceKind = "face" | "full_body" | "unknown";

export interface ReferenceFileInput {
  id: string;
  packageId: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number;
  r2Key: string;
}

export interface ReferenceImage {
  id: string;
  packageId: string;
  scanFileId: string;
  r2Key: string;
  kind: ReferenceKind;
}

/** Is this scan file plausibly a photographic still we can match faces in? */
export function isReferenceCandidate(file: {
  filename: string;
  contentType: string | null;
  sizeBytes: number;
}): boolean {
  const looksImage =
    (file.contentType?.startsWith("image/") ?? false) || IMAGE_EXTENSIONS.test(file.filename);
  if (!looksImage) return false;
  if (NON_REFERENCE_HINTS.test(file.filename)) return false;
  // Below ~20KB it's an icon or a proxy thumbnail; above 10MB the sweep-time
  // fetch would blow the same size cap the candidate downloader uses.
  return file.sizeBytes >= 20_000 && file.sizeBytes <= 10_000_000;
}

/** Best-effort kind classification from the capture's filename. Studios name
 *  scan stills descriptively often enough for this to be worth doing before
 *  any vision model gets involved; "unknown" is a fine answer. */
export function classifyReferenceKind(filename: string): ReferenceKind {
  if (FACE_HINTS.test(filename)) return "face";
  if (BODY_HINTS.test(filename)) return "full_body";
  return "unknown";
}

/**
 * Pick which files become references. Round-robins across packages so a
 * talent with three scans gets angles from all three rather than twelve
 * stills of the newest, and prefers face-hinted files first within each
 * package — the face matcher is the primary consumer.
 */
export function selectReferenceCandidates(
  files: ReferenceFileInput[],
  max = MAX_REFERENCES
): ReferenceFileInput[] {
  const eligible = files.filter(isReferenceCandidate);

  const byPackage = new Map<string, ReferenceFileInput[]>();
  for (const f of eligible) {
    const list = byPackage.get(f.packageId) ?? [];
    list.push(f);
    byPackage.set(f.packageId, list);
  }
  const rank = (f: ReferenceFileInput) => {
    const kind = classifyReferenceKind(f.filename);
    return kind === "face" ? 0 : kind === "full_body" ? 1 : 2;
  };
  for (const list of byPackage.values()) {
    list.sort((a, b) => rank(a) - rank(b) || a.filename.localeCompare(b.filename));
  }

  const selected: ReferenceFileInput[] = [];
  const queues = [...byPackage.values()];
  let drained = false;
  while (selected.length < max && !drained) {
    drained = true;
    for (const queue of queues) {
      const next = queue.shift();
      if (!next) continue;
      drained = false;
      selected.push(next);
      if (selected.length >= max) break;
    }
  }
  return selected;
}

/**
 * Reconcile the reference table with the vault's current contents.
 *
 * DB-only and idempotent: rows whose file or package has gone (deleted,
 * soft-deleted, upload never completed) are removed, newly eligible files are
 * added up to MAX_REFERENCES, existing rows (including 'rejected' ones) are
 * left alone. Safe to run at the top of every sweep.
 */
export async function syncReferenceSet(db: Db, talentId: string): Promise<ReferenceImage[]> {
  const files = await db
    .select({
      id: scanFiles.id,
      packageId: scanFiles.packageId,
      filename: scanFiles.filename,
      contentType: scanFiles.contentType,
      sizeBytes: scanFiles.sizeBytes,
      r2Key: scanFiles.r2Key,
    })
    .from(scanFiles)
    .innerJoin(scanPackages, eq(scanPackages.id, scanFiles.packageId))
    .where(
      and(
        eq(scanPackages.talentId, talentId),
        eq(scanPackages.status, "ready"),
        isNull(scanPackages.deletedAt),
        eq(scanFiles.uploadStatus, "complete")
      )
    )
    .all();

  const existing = await db
    .select()
    .from(monitorReferenceImages)
    .where(eq(monitorReferenceImages.talentId, talentId))
    .all();

  // Drop rows pointing at files that no longer qualify (package deleted or
  // reverted, file removed). inArray on ids, chunked well under D1's
  // parameter cap.
  const liveFileIds = new Set(files.map((f) => f.id));
  const stale = existing.filter((r) => !liveFileIds.has(r.scanFileId));
  for (let i = 0; i < stale.length; i += 80) {
    await db
      .delete(monitorReferenceImages)
      .where(inArray(monitorReferenceImages.id, stale.slice(i, i + 80).map((r) => r.id)));
  }

  const kept = existing.filter((r) => liveFileIds.has(r.scanFileId));
  const referencedFileIds = new Set(kept.map((r) => r.scanFileId));
  const room = MAX_REFERENCES - kept.length;
  if (room > 0) {
    const candidates = selectReferenceCandidates(
      files.filter((f) => !referencedFileIds.has(f.id)),
      room
    );
    const now = Math.floor(Date.now() / 1000);
    for (const file of candidates) {
      const row = {
        id: crypto.randomUUID(),
        talentId,
        packageId: file.packageId,
        scanFileId: file.id,
        r2Key: file.r2Key,
        kind: classifyReferenceKind(file.filename),
        status: "active" as const,
        createdAt: now,
      };
      await db.insert(monitorReferenceImages).values(row);
      kept.push(row as (typeof existing)[number]);
    }
  }

  return kept
    .filter((r) => r.status === "active")
    .map((r) => ({
      id: r.id,
      packageId: r.packageId,
      scanFileId: r.scanFileId,
      r2Key: r.r2Key,
      kind: r.kind as ReferenceKind,
    }));
}

export async function getActiveReferences(db: Db, talentId: string): Promise<ReferenceImage[]> {
  const rows = await db
    .select()
    .from(monitorReferenceImages)
    .where(
      and(eq(monitorReferenceImages.talentId, talentId), eq(monitorReferenceImages.status, "active"))
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    packageId: r.packageId,
    scanFileId: r.scanFileId,
    r2Key: r.r2Key,
    kind: r.kind as ReferenceKind,
  }));
}

// ── Presigning ───────────────────────────────────────────────────────────────

export interface R2SignEnv {
  CF_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

/** Order references for matching: face captures first, then unclassified,
 *  full-body last — the face matcher wants the tightest crops up front. */
export function orderForMatching(refs: ReferenceImage[]): ReferenceImage[] {
  const rank: Record<ReferenceKind, number> = { face: 0, unknown: 1, full_body: 2 };
  return [...refs].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/**
 * Presign GET URLs for the top match sources. Same aws4fetch signing the
 * cover-image route uses; 10-minute TTL comfortably outlives a sweep's
 * identity-check stage. Returns [] when R2 credentials are absent (local
 * dev), which callers treat as "vault references unavailable".
 */
export async function presignReferenceUrls(
  env: R2SignEnv,
  refs: ReferenceImage[],
  max = MAX_MATCH_SOURCES,
  ttlSeconds = 600
): Promise<string[]> {
  if (!env.CF_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return [];
  const bucket = env.R2_BUCKET_NAME ?? "image-vault-scans";
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    region: "auto",
    service: "s3",
  });

  const urls: string[] = [];
  for (const ref of orderForMatching(refs).slice(0, max)) {
    const url = new URL(
      `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${ref.r2Key}`
    );
    url.searchParams.set("X-Amz-Expires", String(ttlSeconds));
    const signed = await client.sign(new Request(url.toString(), { method: "GET" }), {
      aws: { signQuery: true },
    });
    urls.push(signed.url);
  }
  return urls;
}

// ── Detection coverage ───────────────────────────────────────────────────────

export type CoverageTier = "unanchored" | "baseline" | "anchored" | "fortified";

export interface CoverageInput {
  faceReferenceCount: number;
  bodyReferenceCount: number;
  /** References not yet classified as face or body. */
  unknownReferenceCount: number;
  /** Distinct scan packages contributing references. */
  packageCount: number;
  geometryFingerprintCount: number;
  hasProfileImage: boolean;
}

export interface DetectionCoverage {
  tier: CoverageTier;
  /** 0-100. Explainable: each component below sums into it. */
  score: number;
  /** Ordered, talent-facing: the single most valuable next upload first. */
  improvements: string[];
}

/**
 * Score how well-anchored this talent's detection is.
 *
 * The components mirror what the matcher can actually use — this is not a
 * marketing number. Face references carry the most weight because the face
 * matcher is the primary detector; body references and fingerprints extend
 * coverage to full-body synthesis and provenance tracing; multiple packages
 * mean pose/lighting diversity, which is what defeats the single-photo
 * failure mode (one angle, one lighting rig, easy to dodge).
 */
export function computeDetectionCoverage(input: CoverageInput): DetectionCoverage {
  // Unknown-kind references still feed the matcher, just less predictably —
  // count them at half a face reference's value.
  const faceEquivalent = input.faceReferenceCount + input.unknownReferenceCount / 2;

  let score = 0;
  if (input.hasProfileImage) score += 10;
  score += Math.min(faceEquivalent, 4) * 10; // up to 40
  score += Math.min(input.bodyReferenceCount, 2) * 10; // up to 20
  if (input.packageCount >= 2) score += 15;
  if (input.geometryFingerprintCount > 0) score += 15;
  score = Math.min(100, Math.round(score));

  const anchored = faceEquivalent >= 1 || input.bodyReferenceCount >= 1;
  const tier: CoverageTier =
    score >= 80 && anchored
      ? "fortified"
      : anchored
        ? "anchored"
        : input.hasProfileImage
          ? "baseline"
          : "unanchored";

  const improvements: string[] = [];
  if (!anchored) {
    improvements.push(
      "Upload a scan package with face captures — matching currently relies on a single public photo."
    );
  } else if (faceEquivalent < 4) {
    improvements.push("Add more face angles — each capture angle closes a pose the matcher can miss.");
  }
  if (input.bodyReferenceCount === 0) {
    improvements.push("Add a full-body scan to extend detection beyond the face to full-figure synthesis.");
  }
  if (input.packageCount < 2) {
    improvements.push("A second scan package adds lighting and session diversity to the reference set.");
  }
  if (input.geometryFingerprintCount === 0) {
    improvements.push(
      "License a delivery to activate geometry fingerprinting — it traces leaked scan data back to source."
    );
  }
  if (!input.hasProfileImage) {
    improvements.push("Link your public profile photo as a fallback reference.");
  }

  return { tier, score, improvements };
}

/** Bundle a talent's reference rows into the coverage input shape. */
export function coverageInputFromReferences(
  refs: ReferenceImage[],
  extra: { geometryFingerprintCount: number; hasProfileImage: boolean }
): CoverageInput {
  return {
    faceReferenceCount: refs.filter((r) => r.kind === "face").length,
    bodyReferenceCount: refs.filter((r) => r.kind === "full_body").length,
    unknownReferenceCount: refs.filter((r) => r.kind === "unknown").length,
    packageCount: new Set(refs.map((r) => r.packageId)).size,
    geometryFingerprintCount: extra.geometryFingerprintCount,
    hasProfileImage: extra.hasProfileImage,
  };
}
