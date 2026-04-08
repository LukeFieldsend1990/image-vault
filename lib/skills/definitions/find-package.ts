import { registerSkill } from "../registry";
import type { SkillDefinition } from "../types";
import { scanPackages, scanFiles, users, talentProfiles } from "@/lib/db/schema";
import { eq, and, like, or, desc, isNull, sql } from "drizzle-orm";

const skill: SkillDefinition = {
  id: "find-package",
  name: "Find Package & Start Licence",
  description: "Search scan packages by name or talent and link directly to the licence request flow",
  categories: ["licence_request"],
  parameters: [
    {
      name: "package_name",
      type: "string",
      description: "Name of the scan package or production",
      required: false,
    },
    {
      name: "talent_name",
      type: "string",
      description: "Name of the talent who owns the package",
      required: false,
    },
  ],

  async execute(ctx, params) {
    const { session, db } = ctx;

    const packageName = (params.package_name as string)?.trim();
    const talentName = (params.talent_name as string)?.trim();

    if (!packageName && !talentName) {
      return { success: false, message: "Provide a package name or talent name to search." };
    }

    function sanitise(s: string): string {
      return s.replace(/[%_]/g, "");
    }

    // Build search conditions on package name
    const conditions: ReturnType<typeof like>[] = [];
    if (packageName) {
      conditions.push(like(scanPackages.name, `%${sanitise(packageName)}%`));
    }

    // If talent name provided, find matching user IDs first
    let talentIds: string[] = [];
    if (talentName) {
      const profileMatches = await db
        .select({ userId: talentProfiles.userId })
        .from(talentProfiles)
        .where(like(talentProfiles.fullName, `%${sanitise(talentName)}%`))
        .all();
      talentIds = profileMatches.map((r) => r.userId);

      // Also search by email prefix as fallback
      const emailMatches = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "talent"), like(users.email, `%${sanitise(talentName)}%`)))
        .all();
      for (const m of emailMatches) {
        if (!talentIds.includes(m.id)) talentIds.push(m.id);
      }
    }

    // Query packages — only non-deleted, ready packages
    const baseCondition = and(
      eq(scanPackages.status, "ready"),
      isNull(scanPackages.deletedAt)
    );

    let searchCondition;
    if (conditions.length > 0 && talentIds.length > 0) {
      // Match either package name or talent ownership
      searchCondition = or(
        ...conditions,
        ...talentIds.map((tid) => eq(scanPackages.talentId, tid))
      );
    } else if (conditions.length > 0) {
      searchCondition = or(...conditions);
    } else if (talentIds.length > 0) {
      searchCondition = or(...talentIds.map((tid) => eq(scanPackages.talentId, tid)));
    } else {
      return { success: true, message: "No matching packages found.", data: { packages: [], count: 0 } };
    }

    const rows = await db
      .select({
        id: scanPackages.id,
        name: scanPackages.name,
        description: scanPackages.description,
        scanType: scanPackages.scanType,
        totalSizeBytes: scanPackages.totalSizeBytes,
        hasMesh: scanPackages.hasMesh,
        hasTexture: scanPackages.hasTexture,
        hasHdr: scanPackages.hasHdr,
        hasMotionCapture: scanPackages.hasMotionCapture,
        tags: scanPackages.tags,
        talentId: scanPackages.talentId,
        createdAt: scanPackages.createdAt,
      })
      .from(scanPackages)
      .where(and(baseCondition, searchCondition))
      .orderBy(desc(scanPackages.createdAt))
      .limit(10)
      .all();

    if (rows.length === 0) {
      return {
        success: true,
        message: "No matching packages found.",
        data: { packages: [], count: 0 },
      };
    }

    // Fetch talent names and file counts
    const talentUserIds = Array.from(new Set(rows.map((r) => r.talentId)));
    const [profiles, fileCounts] = await Promise.all([
      db
        .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
        .from(talentProfiles)
        .where(or(...talentUserIds.map((id) => eq(talentProfiles.userId, id))))
        .all(),
      db
        .select({
          packageId: scanFiles.packageId,
          count: sql<number>`count(*)`,
        })
        .from(scanFiles)
        .where(or(...rows.map((r) => eq(scanFiles.packageId, r.id))))
        .groupBy(scanFiles.packageId)
        .all(),
    ]);

    const profileMap = new Map(profiles.map((p) => [p.userId, p.fullName]));
    const fileCountMap = new Map(fileCounts.map((f) => [f.packageId, f.count]));

    function formatBytes(bytes: number | null): string {
      if (!bytes) return "—";
      if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
      return `${(bytes / 1073741824).toFixed(1)} GB`;
    }

    const baseUrl = (ctx.env.NEXT_PUBLIC_BASE_URL as string) ?? "https://changling.io";

    const packages = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      talentName: profileMap.get(r.talentId) ?? "Unknown",
      scanType: r.scanType,
      totalSize: formatBytes(r.totalSizeBytes),
      fileCount: fileCountMap.get(r.id) ?? 0,
      hasMesh: r.hasMesh,
      hasTexture: r.hasTexture,
      hasHdr: r.hasHdr,
      hasMotionCapture: r.hasMotionCapture,
      tags: r.tags,
      licenceRequestLink: `${baseUrl}/licences/request/${r.id}`,
    }));

    return {
      success: true,
      message: `Found ${packages.length} matching package${packages.length === 1 ? "" : "s"}.`,
      data: { packages, count: packages.length },
    };
  },
};

registerSkill(skill);
