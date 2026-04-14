/**
 * Vectorize index management — upsert and delete package vectors.
 */

import { eq } from "drizzle-orm";
import { scanPackages } from "@/lib/db/schema";
import { buildSearchDocument, embedText, fetchPackageForEmbedding } from "./embed";

type DrizzleDb = ReturnType<typeof import("@/lib/db").getDb>;

// ── Vectorize metadata ──────────────────────────────────────────────────────

// ── Index a single package ──────────────────────────────────────────────────

/**
 * Build search document, embed it, and upsert the vector into Vectorize.
 * Also stamps `search_indexed_at` on the package row.
 */
export async function indexPackage(
  env: { AI: Ai; VECTORIZE: VectorizeIndex },
  db: DrizzleDb,
  packageId: string,
): Promise<boolean> {
  const data = await fetchPackageForEmbedding(db, packageId);
  if (!data) return false;

  const { pkg, tags, talent } = data;
  const searchDoc = buildSearchDocument(pkg, tags, talent);
  const embedding = await embedText(env.AI, searchDoc);

  // Vectorize metadata values must be string | number | boolean | string[]
  const metadata: Record<string, string | number | boolean | string[]> = {
    packageId: pkg.id,
    talentId: pkg.talentId,
    status: "ready",
    scanType: pkg.scanType ?? "unknown",
    hasMesh: pkg.hasMesh ?? false,
    hasTexture: pkg.hasTexture ?? false,
    hasHdr: pkg.hasHdr ?? false,
    updatedAt: Math.floor(Date.now() / 1000),
  };

  await env.VECTORIZE.upsert([
    {
      id: packageId,
      values: embedding,
      metadata,
    },
  ]);

  // Stamp indexed time on the package
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(scanPackages)
    .set({ searchIndexedAt: now })
    .where(eq(scanPackages.id, packageId));

  return true;
}

// ── Remove a package from the index ─────────────────────────────────────────

export async function removePackage(
  env: { VECTORIZE: VectorizeIndex },
  packageId: string,
): Promise<void> {
  await env.VECTORIZE.deleteByIds([packageId]);
}

// ── Batch index (for backfill) ──────────────────────────────────────────────

/**
 * Index multiple packages. Returns count of successfully indexed packages.
 * Processes sequentially to avoid hitting Workers AI rate limits.
 */
export async function indexPackageBatch(
  env: { AI: Ai; VECTORIZE: VectorizeIndex },
  db: DrizzleDb,
  packageIds: string[],
): Promise<number> {
  let indexed = 0;
  for (const id of packageIds) {
    try {
      const ok = await indexPackage(env, db, id);
      if (ok) indexed++;
    } catch (err) {
      console.error(`Failed to index package ${id}:`, err);
    }
  }
  return indexed;
}
