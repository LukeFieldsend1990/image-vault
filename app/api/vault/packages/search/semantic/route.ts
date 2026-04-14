export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanPackages, packageTags, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { semanticSearch } from "@/lib/search/query";
import { and, isNull, inArray } from "drizzle-orm";

/**
 * GET /api/vault/packages/search/semantic
 *
 * Semantic search for licensees. Embeds the query via Workers AI,
 * searches Vectorize for similar packages, returns ranked results.
 *
 * Query params:
 *   q        — natural language search query (required)
 *   exclude  — comma-separated package IDs to exclude (from keyword results)
 *   limit    — max results (default 20, max 50)
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  // Licensee-only for now
  if (session.role !== "licensee" && session.role !== "admin") {
    return NextResponse.json(
      { error: "Semantic search is available to licensees" },
      { status: 403 }
    );
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
  }

  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10),
    50
  );
  const excludeParam = req.nextUrl.searchParams.get("exclude") ?? "";
  const excludeIds = excludeParam ? excludeParam.split(",").filter(Boolean) : [];

  const { env } = getRequestContext();

  if (!env.VECTORIZE || !env.AI) {
    return NextResponse.json(
      { error: "Semantic search is not configured" },
      { status: 503 }
    );
  }

  const db = getDb();

  // Run semantic search
  const semanticResults = await semanticSearch(env, db, q, {
    limit,
    excludeIds,
  });

  if (semanticResults.length === 0) {
    return NextResponse.json({ packages: [], semanticCount: 0 });
  }

  // Fetch full package data for the results
  const resultIds = semanticResults.map((r) => r.packageId);
  const scoreMap = new Map(semanticResults.map((r) => [r.packageId, r]));

  const packages = await db
    .select({
      id: scanPackages.id,
      name: scanPackages.name,
      description: scanPackages.description,
      talentId: scanPackages.talentId,
      status: scanPackages.status,
      coverImageKey: scanPackages.coverImageKey,
      totalSizeBytes: scanPackages.totalSizeBytes,
      createdAt: scanPackages.createdAt,
      tags: scanPackages.tags,
    })
    .from(scanPackages)
    .where(
      and(
        inArray(scanPackages.id, resultIds),
        isNull(scanPackages.deletedAt),
      )
    )
    .all();

  // Fetch structured tags
  const structuredTags =
    resultIds.length > 0
      ? await db
          .select({
            packageId: packageTags.packageId,
            tag: packageTags.tag,
            category: packageTags.category,
            status: packageTags.status,
          })
          .from(packageTags)
          .where(inArray(packageTags.packageId, resultIds))
          .all()
      : [];

  const tagsByPackage = new Map<string, typeof structuredTags>();
  for (const t of structuredTags) {
    const arr = tagsByPackage.get(t.packageId) ?? [];
    arr.push(t);
    tagsByPackage.set(t.packageId, arr);
  }

  // Fetch talent names
  const talentIds = [...new Set(packages.map((p) => p.talentId))];
  const talents =
    talentIds.length > 0
      ? await db
          .select({
            userId: talentProfiles.userId,
            fullName: talentProfiles.fullName,
          })
          .from(talentProfiles)
          .where(inArray(talentProfiles.userId, talentIds))
          .all()
      : [];
  const talentNameMap = new Map(talents.map((t) => [t.userId, t.fullName]));

  // Build response sorted by composite score
  const results = packages
    .map((p) => {
      const scores = scoreMap.get(p.id);
      return {
        ...p,
        structuredTags: tagsByPackage.get(p.id) ?? [],
        talentName: talentNameMap.get(p.talentId) ?? null,
        matchType: "semantic" as const,
        relevanceScore: scores?.cosineScore ?? null,
        compositeScore: scores?.compositeScore ?? 0,
      };
    })
    .sort((a, b) => b.compositeScore - a.compositeScore);

  return NextResponse.json({
    packages: results,
    semanticCount: results.length,
  });
}
