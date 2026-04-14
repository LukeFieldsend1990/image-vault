export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanPackages, packageTags, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and, like, sql, isNull, inArray } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const tag = req.nextUrl.searchParams.get("tag");
  const category = req.nextUrl.searchParams.get("category");
  const q = req.nextUrl.searchParams.get("q");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10), 100);
  const offset = parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10);

  const db = getDb();

  // Build conditions for scan_packages
  const pkgConditions = [isNull(scanPackages.deletedAt)];

  // Licensees see all non-deleted packages; talent/rep see only their own
  if (session.role === "talent") {
    pkgConditions.push(eq(scanPackages.talentId, session.sub));
  }

  // If filtering by tag or category, find matching package IDs first
  let tagFilteredIds: string[] | null = null;

  if (tag || category) {
    const tagConditions = [];
    if (tag) tagConditions.push(eq(packageTags.tag, tag));
    if (category) tagConditions.push(eq(packageTags.category, category));

    const matchingTags = await db
      .select({ packageId: packageTags.packageId })
      .from(packageTags)
      .where(and(...tagConditions))
      .all();

    tagFilteredIds = [...new Set(matchingTags.map((t: { packageId: string }) => t.packageId))];
    if (tagFilteredIds.length === 0) {
      return NextResponse.json({ packages: [], total: 0 });
    }
  }

  // Text search across package name, description, tags, and talent name
  if (q) {
    const searchTerm = `%${q}%`;

    // Find packages matching text in name/description
    const textMatches = await db
      .select({ id: scanPackages.id })
      .from(scanPackages)
      .where(
        and(
          ...pkgConditions,
          sql`(${scanPackages.name} LIKE ${searchTerm} OR ${scanPackages.description} LIKE ${searchTerm} OR ${scanPackages.tags} LIKE ${searchTerm})`
        )
      )
      .all();

    // Find packages matching talent name
    const talentMatches = await db
      .select({ id: scanPackages.id })
      .from(scanPackages)
      .innerJoin(talentProfiles, eq(scanPackages.talentId, talentProfiles.userId))
      .where(
        and(
          ...pkgConditions,
          like(talentProfiles.fullName, searchTerm)
        )
      )
      .all();

    // Find packages matching tag text
    const tagTextMatches = await db
      .select({ packageId: packageTags.packageId })
      .from(packageTags)
      .where(like(packageTags.tag, searchTerm))
      .all();

    const allIds = new Set([
      ...textMatches.map((r) => r.id),
      ...talentMatches.map((r) => r.id),
      ...tagTextMatches.map((r) => r.packageId),
    ]);

    // Intersect with tag filter if active
    if (tagFilteredIds) {
      const tagSet = new Set(tagFilteredIds);
      tagFilteredIds = [...allIds].filter((id) => tagSet.has(id));
    } else {
      tagFilteredIds = [...allIds];
    }

    if (tagFilteredIds.length === 0) {
      return NextResponse.json({ packages: [], total: 0 });
    }
  }

  // Final query
  const finalConditions = [...pkgConditions];
  if (tagFilteredIds) {
    finalConditions.push(inArray(scanPackages.id, tagFilteredIds));
  }

  const [packages, countResult] = await Promise.all([
    db
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
      .where(and(...finalConditions))
      .orderBy(sql`${scanPackages.createdAt} DESC`)
      .limit(limit)
      .offset(offset)
      .all(),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(scanPackages)
      .where(and(...finalConditions))
      .get(),
  ]);

  // Fetch structured tags for returned packages
  const packageIds = packages.map((p) => p.id);
  const structuredTags =
    packageIds.length > 0
      ? await db
          .select({
            packageId: packageTags.packageId,
            tag: packageTags.tag,
            category: packageTags.category,
            status: packageTags.status,
          })
          .from(packageTags)
          .where(inArray(packageTags.packageId, packageIds))
          .all()
      : [];

  // Group tags by package
  const tagsByPackage = new Map<string, typeof structuredTags>();
  for (const t of structuredTags) {
    const arr = tagsByPackage.get(t.packageId) ?? [];
    arr.push(t);
    tagsByPackage.set(t.packageId, arr);
  }

  // Fetch talent names for returned packages
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

  const results = packages.map((p) => ({
    ...p,
    structuredTags: tagsByPackage.get(p.id) ?? [],
    talentName: talentNameMap.get(p.talentId) ?? null,
  }));

  return NextResponse.json({
    packages: results,
    total: countResult?.count ?? 0,
  });
}
