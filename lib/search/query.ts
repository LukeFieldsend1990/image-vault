/**
 * Semantic search query — embed user query, kNN search Vectorize,
 * composite ranking with multiple signals.
 */

import { inArray } from "drizzle-orm";
import { scanPackages, talentProfiles } from "@/lib/db/schema";
import { embedText } from "./embed";

type DrizzleDb = ReturnType<typeof import("@/lib/db").getDb>;

// ── Types ───────────────────────────────────────────────────────────────────

export interface SemanticResult {
  packageId: string;
  cosineScore: number;
  compositeScore: number;
}

interface VectorizeMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

// ── Ranking weights ─────────────────────────────────────────────────────────

const WEIGHTS = {
  cosine: 0.50,
  recency: 0.15,
  completeness: 0.15,
  popularity: 0.20,
} as const;

// Minimum cosine similarity to include in results.
// Below this threshold, the match is too weak to be useful.
const MIN_COSINE_SCORE = 0.55;

// Normalise a unix timestamp to 0–1 where newer = higher.
// Uses a 2-year window — packages older than 2 years score 0.
function recencyScore(createdAt: number): number {
  const twoYears = 2 * 365 * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  const age = now - createdAt;
  return Math.max(0, 1 - age / twoYears);
}

// Score based on how many metadata fields are populated
function completenessScore(pkg: {
  hasMesh: boolean | null;
  hasTexture: boolean | null;
  hasHdr: boolean | null;
  hasMotionCapture: boolean | null;
  resolution: string | null;
  polygonCount: number | null;
  colorSpace: string | null;
}): number {
  const fields = [
    pkg.hasMesh,
    pkg.hasTexture,
    pkg.hasHdr,
    pkg.hasMotionCapture,
    pkg.resolution !== null,
    pkg.polygonCount !== null,
    pkg.colorSpace !== null,
  ];
  return fields.filter(Boolean).length / fields.length;
}

// ── Main semantic search ────────────────────────────────────────────────────

/**
 * Embed a query and search Vectorize for similar packages.
 * Returns ranked results with composite scores.
 *
 * @param excludeIds - package IDs to exclude (already returned by keyword search)
 */
export async function semanticSearch(
  env: { AI: Ai; VECTORIZE: VectorizeIndex },
  db: DrizzleDb,
  query: string,
  options: {
    limit?: number;
    excludeIds?: string[];
  } = {},
): Promise<SemanticResult[]> {
  const { limit = 20, excludeIds = [] } = options;

  // Request more than needed so we can exclude + re-rank
  const topK = Math.min(limit + excludeIds.length + 10, 100);

  // Embed the query
  const queryEmbedding = await embedText(env.AI, query);

  // kNN search
  const matches = await env.VECTORIZE.query(queryEmbedding, {
    topK,
    returnMetadata: "all",
  });

  // Filter out excluded IDs and low-relevance matches
  const excludeSet = new Set(excludeIds);
  const filtered = (matches.matches as VectorizeMatch[]).filter(
    (m) => !excludeSet.has(m.id) && m.score >= MIN_COSINE_SCORE
  );

  if (filtered.length === 0) return [];

  // Fetch package metadata for ranking
  const matchIds = filtered.map((m) => m.id);
  const packages = await db
    .select({
      id: scanPackages.id,
      talentId: scanPackages.talentId,
      createdAt: scanPackages.createdAt,
      hasMesh: scanPackages.hasMesh,
      hasTexture: scanPackages.hasTexture,
      hasHdr: scanPackages.hasHdr,
      hasMotionCapture: scanPackages.hasMotionCapture,
      resolution: scanPackages.resolution,
      polygonCount: scanPackages.polygonCount,
      colorSpace: scanPackages.colorSpace,
    })
    .from(scanPackages)
    .where(inArray(scanPackages.id, matchIds))
    .all();

  // Fetch talent popularity for matched packages
  const talentIds = [...new Set(packages.map((p) => p.talentId))];
  const talents =
    talentIds.length > 0
      ? await db
          .select({
            userId: talentProfiles.userId,
            popularity: talentProfiles.popularity,
          })
          .from(talentProfiles)
          .where(inArray(talentProfiles.userId, talentIds))
          .all()
      : [];

  const popularityMap = new Map(talents.map((t) => [t.userId, t.popularity ?? 0]));
  // Normalise popularity: divide by max (TMDB popularity can be 0-200+)
  const maxPopularity = Math.max(...[...popularityMap.values()], 1);

  const pkgMap = new Map(packages.map((p) => [p.id, p]));

  // Compute composite scores
  const results: SemanticResult[] = [];
  for (const match of filtered) {
    const pkg = pkgMap.get(match.id);
    if (!pkg) continue;

    const cosine = match.score; // 0–1
    const recency = recencyScore(pkg.createdAt);
    const completeness = completenessScore(pkg);
    const popularity = (popularityMap.get(pkg.talentId) ?? 0) / maxPopularity;

    const compositeScore =
      WEIGHTS.cosine * cosine +
      WEIGHTS.recency * recency +
      WEIGHTS.completeness * completeness +
      WEIGHTS.popularity * popularity;

    results.push({
      packageId: match.id,
      cosineScore: cosine,
      compositeScore,
    });
  }

  // Sort by composite score descending, take limit
  results.sort((a, b) => b.compositeScore - a.compositeScore);
  return results.slice(0, limit);
}
