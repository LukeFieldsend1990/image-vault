/**
 * Search document builder + embedding generator for semantic search.
 *
 * Each package gets a plaintext "search document" combining all metadata,
 * tags, and talent info. This text is embedded via Workers AI (bge-base-en-v1.5)
 * and stored in Cloudflare Vectorize.
 */

import { eq, and, isNull } from "drizzle-orm";
import { scanPackages, packageTags, talentProfiles } from "@/lib/db/schema";

type DrizzleDb = ReturnType<typeof import("@/lib/db").getDb>;

// ── Search document builder ─────────────────────────────────────────────────

export interface PackageData {
  id: string;
  talentId: string;
  name: string;
  description: string | null;
  scanType: string | null;
  resolution: string | null;
  polygonCount: number | null;
  colorSpace: string | null;
  hasMesh: boolean | null;
  hasTexture: boolean | null;
  hasHdr: boolean | null;
  hasMotionCapture: boolean | null;
  compatibleEngines: string | null;
  tags: string | null;
}

interface TagData {
  tag: string;
  category: string;
}

interface TalentData {
  fullName: string;
  knownFor: string;
  popularity: number | null;
}

/**
 * Build a plaintext search document from package data, structured tags,
 * and talent profile. Structured for embedding quality.
 */
export function buildSearchDocument(
  pkg: PackageData,
  structuredTags: TagData[],
  talent: TalentData | null,
): string {
  const lines: string[] = [];

  // Package identity
  lines.push(`Package: ${pkg.name}`);
  if (pkg.description) lines.push(`Description: ${pkg.description}`);

  // Structured metadata
  const meta: string[] = [];
  if (pkg.scanType) meta.push(`Scan type: ${pkg.scanType}`);
  if (pkg.resolution) meta.push(`Resolution: ${pkg.resolution}`);
  if (pkg.polygonCount) meta.push(`Polys: ${pkg.polygonCount.toLocaleString()}`);
  if (pkg.colorSpace) meta.push(`Color space: ${pkg.colorSpace}`);
  if (meta.length > 0) lines.push(meta.join(" | "));

  // Structured AI/user tags grouped by category
  if (structuredTags.length > 0) {
    const byCategory = new Map<string, string[]>();
    for (const t of structuredTags) {
      const arr = byCategory.get(t.category) ?? [];
      arr.push(t.tag);
      byCategory.set(t.category, arr);
    }
    const tagParts = [...byCategory.entries()].map(
      ([cat, tags]) => `${cat}: ${tags.join(", ")}`
    );
    lines.push(`Tags: ${tagParts.join(" | ")}`);
  }

  // User freeform tags
  if (pkg.tags) {
    try {
      const userTags = JSON.parse(pkg.tags) as string[];
      if (userTags.length > 0) {
        lines.push(`User tags: ${userTags.join(", ")}`);
      }
    } catch {
      // malformed JSON — skip
    }
  }

  // Feature flags
  const features: string[] = [];
  if (pkg.hasMesh) features.push("mesh");
  if (pkg.hasTexture) features.push("texture");
  if (pkg.hasHdr) features.push("HDR");
  if (pkg.hasMotionCapture) features.push("motion capture");
  if (features.length > 0) lines.push(`Features: ${features.join(", ")}`);

  // Compatible engines
  if (pkg.compatibleEngines) {
    try {
      const engines = JSON.parse(pkg.compatibleEngines) as string[];
      if (engines.length > 0) {
        lines.push(`Compatible engines: ${engines.join(", ")}`);
      }
    } catch {
      // malformed JSON — skip
    }
  }

  // Talent profile
  if (talent) {
    let talentLine = `Talent: ${talent.fullName}`;
    try {
      const knownFor = JSON.parse(talent.knownFor) as string[];
      if (knownFor.length > 0) {
        talentLine += ` — known for ${knownFor.join(", ")}`;
      }
    } catch {
      // malformed JSON — skip
    }
    lines.push(talentLine);
  }

  return lines.join("\n");
}

// ── Fetch package data for embedding ────────────────────────────────────────

export async function fetchPackageForEmbedding(
  db: DrizzleDb,
  packageId: string,
): Promise<{ pkg: PackageData; tags: TagData[]; talent: TalentData | null } | null> {
  const pkg = await db
    .select({
      id: scanPackages.id,
      name: scanPackages.name,
      description: scanPackages.description,
      talentId: scanPackages.talentId,
      scanType: scanPackages.scanType,
      resolution: scanPackages.resolution,
      polygonCount: scanPackages.polygonCount,
      colorSpace: scanPackages.colorSpace,
      hasMesh: scanPackages.hasMesh,
      hasTexture: scanPackages.hasTexture,
      hasHdr: scanPackages.hasHdr,
      hasMotionCapture: scanPackages.hasMotionCapture,
      compatibleEngines: scanPackages.compatibleEngines,
      tags: scanPackages.tags,
    })
    .from(scanPackages)
    .where(
      and(
        eq(scanPackages.id, packageId),
        isNull(scanPackages.deletedAt),
      )
    )
    .get();

  if (!pkg) return null;

  // Fetch accepted + user tags (not dismissed)
  const tags = await db
    .select({ tag: packageTags.tag, category: packageTags.category })
    .from(packageTags)
    .where(
      and(
        eq(packageTags.packageId, packageId),
        // include accepted and user-suggested (not dismissed)
        // status IN ('accepted', 'suggested') — suggested from users still count
      )
    )
    .all();

  // Filter: accepted tags + user-suggested tags (not dismissed)
  const activeTags = tags; // all non-dismissed are useful for search

  // Fetch talent profile
  const talent = await db
    .select({
      fullName: talentProfiles.fullName,
      knownFor: talentProfiles.knownFor,
      popularity: talentProfiles.popularity,
    })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, pkg.talentId))
    .get();

  return { pkg, tags: activeTags, talent: talent ?? null };
}

// ── Embedding via Workers AI ────────────────────────────────────────────────

/**
 * Generate a 768-dim embedding using Workers AI bge-base-en-v1.5.
 */
export async function embedText(
  ai: Ai,
  text: string,
): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-base-en-v1.5", {
    text: [text],
  });

  // Workers AI returns { shape: [1, 768], data: [[...]] } or async response
  if (!("data" in result) || !result.data?.[0]) {
    throw new Error("Unexpected embedding response — no data returned");
  }
  return result.data[0];
}
