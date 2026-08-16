/**
 * The derivation layer's index and reading: 64-bit dHashes of the talent's
 * reference stills, compared against candidate thumbnails at sweep time.
 *
 * This closes the loop the signal vocabulary has promised since Phase 1 —
 * `perceptualHashDistance` finally carries a measurement. It answers one
 * narrow question the identity and synthetic layers cannot: was this
 * candidate image *derived from vault imagery* (repost, leak, screenshot,
 * light edit)? It does not recognise faces and it does not detect novel
 * synthesis; see docs/deepfake-detection.md for what a reading proves.
 *
 * Cost profile: pure CPU. Indexing is lazy and capped per sweep — steady
 * state is zero work; candidate hashing is a thumbnail fetch plus a
 * millisecond of arithmetic per image. No AI spend, no third-party calls,
 * and bytes never leave the platform boundary.
 */

import { and, eq, isNotNull } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { monitorPhashIndex } from "@/lib/db/schema";
import { fetchImageBytes } from "./identity-check";
import { PHASH_ALGORITHM, hammingDistance64, hashImage } from "./phash";
import { presignR2Url, type R2SignEnv, type ReferenceImage } from "./reference-set";
import type { CandidateContent } from "./types";

type Db = ReturnType<typeof getDb>;

/** New references hashed per sweep. Bounds decode CPU in the scan path —
 *  a full gallery is indexed within three sweeps, then this is a no-op. */
export const MAX_NEW_HASHES_PER_SWEEP = 4;

/** Parallel thumbnail fetches while scoring candidates. */
const CANDIDATE_FETCH_CONCURRENCY = 4;

/** Distance at or under which the adjudicator reads derivation (matches the
 *  prompt contract in scan.ts). Exported for display thresholds. */
export const PHASH_DERIVATION_THRESHOLD = 16;

export interface PhashIndexEntry {
  hashHex: string;
  source: "scan_still" | "derived_render";
}

/**
 * Hash reference stills that have no index row yet. Lazy, idempotent, and
 * capped: called at the top of every sweep right after syncReferenceSet.
 * Failures (oversized, undecodable, webp) are recorded as status='failed'
 * so the same file is never fetched twice — mirrors the 'rejected' pattern
 * on monitor_reference_images.
 */
export async function ensurePhashIndex(
  db: Db,
  env: R2SignEnv,
  talentId: string,
  references: ReferenceImage[]
): Promise<{ hashed: number; failed: number; pending: number }> {
  const existing = await db
    .select({ r2Key: monitorPhashIndex.r2Key })
    .from(monitorPhashIndex)
    .where(eq(monitorPhashIndex.talentId, talentId))
    .all();
  const indexed = new Set(existing.map((r) => r.r2Key));

  const missing = references.filter((r) => !indexed.has(r.r2Key));
  const batch = missing.slice(0, MAX_NEW_HASHES_PER_SWEEP);

  let hashed = 0;
  let failed = 0;
  const now = Math.floor(Date.now() / 1000);
  for (const ref of batch) {
    const url = await presignR2Url(env, ref.r2Key);
    // No R2 credentials (local dev): leave the file unindexed rather than
    // recording a failure it would never recover from.
    if (!url) break;

    const bytes = await fetchImageBytes(url);
    const result = bytes ? hashImage(bytes) : null;
    await db.insert(monitorPhashIndex).values({
      id: crypto.randomUUID(),
      talentId,
      packageId: ref.packageId,
      scanFileId: ref.scanFileId,
      r2Key: ref.r2Key,
      source: ref.r2Key.startsWith("derived/") ? "derived_render" : "scan_still",
      algorithm: PHASH_ALGORITHM,
      hashHex: result?.hashHex ?? null,
      width: result?.width ?? null,
      height: result?.height ?? null,
      status: result ? "hashed" : "failed",
      createdAt: now,
    });
    if (result) hashed += 1;
    else failed += 1;
  }

  return { hashed, failed, pending: missing.length - batch.length };
}

/** All usable hashes for one talent. */
export async function loadPhashIndex(db: Db, talentId: string): Promise<PhashIndexEntry[]> {
  const rows = await db
    .select({ hashHex: monitorPhashIndex.hashHex, source: monitorPhashIndex.source })
    .from(monitorPhashIndex)
    .where(
      and(
        eq(monitorPhashIndex.talentId, talentId),
        eq(monitorPhashIndex.status, "hashed"),
        isNotNull(monitorPhashIndex.hashHex)
      )
    )
    .all();
  return rows
    .filter((r): r is { hashHex: string; source: "scan_still" | "derived_render" } => !!r.hashHex)
    .map((r) => ({ hashHex: r.hashHex, source: r.source }));
}

/** Minimum Hamming distance of one hash against the whole index. */
export function minDistanceAgainstIndex(hashHex: string, index: PhashIndexEntry[]): number | null {
  if (!index.length) return null;
  let min = 64;
  for (const entry of index) {
    const d = hammingDistance64(hashHex, entry.hashHex);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Populate `signals.perceptualHashDistance` on candidates that carry a
 * thumbnail. The reading is the minimum distance against the whole index —
 * derivation from *any* vault still counts. Candidates whose thumbnail
 * cannot be fetched or decoded keep null: "not measured", never "no match".
 */
export async function scoreCandidatesPhash(
  index: PhashIndexEntry[],
  candidates: CandidateContent[]
): Promise<{ measured: number; matched: number }> {
  if (!index.length) return { measured: 0, matched: 0 };

  const scorable = candidates.filter(
    (c) => c.media?.thumbnailUrl && c.signals.perceptualHashDistance === null
  );

  let measured = 0;
  let matched = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < scorable.length) {
      const candidate = scorable[cursor++];
      const bytes = await fetchImageBytes(candidate.media!.thumbnailUrl!);
      const result = bytes ? hashImage(bytes) : null;
      if (!result) continue;
      const distance = minDistanceAgainstIndex(result.hashHex, index);
      if (distance === null) continue;
      candidate.signals.perceptualHashDistance = distance;
      measured += 1;
      if (distance <= PHASH_DERIVATION_THRESHOLD) matched += 1;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CANDIDATE_FETCH_CONCURRENCY, scorable.length) }, worker)
  );

  return { measured, matched };
}
