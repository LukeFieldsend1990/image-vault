import type { drizzle } from "drizzle-orm/d1";
import {
  licences,
  scanPackages,
  scanFiles,
  talentReps,
  talentProfiles,
  refreshTokens,
  users,
  downloadEvents,
} from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";

type Db = ReturnType<typeof drizzle>;

export interface Signal {
  type: string;
  data: Record<string, unknown>;
}

async function getTalentIdsForRep(db: Db, repId: string): Promise<string[]> {
  const rows = await db
    .select({ talentId: talentReps.talentId })
    .from(talentReps)
    .where(eq(talentReps.repId, repId))
    .all();
  return rows.map((r) => r.talentId);
}

export async function getPendingLicenceSignals(db: Db, repId: string): Promise<Signal[]> {
  const talentIds = await getTalentIdsForRep(db, repId);
  if (talentIds.length === 0) return [];

  const rows = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      licenceType: licences.licenceType,
      proposedFee: licences.proposedFee,
      createdAt: licences.createdAt,
    })
    .from(licences)
    .where(and(inArray(licences.talentId, talentIds), eq(licences.status, "PENDING")))
    .all();

  if (rows.length === 0) return [];

  // Enrich with talent names
  const profiles = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .where(inArray(talentProfiles.userId, talentIds))
    .all();
  const nameMap = new Map(profiles.map((p) => [p.userId, p.fullName]));

  // Group by talent
  const byTalent = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byTalent.get(row.talentId) ?? [];
    list.push(row);
    byTalent.set(row.talentId, list);
  }

  const signals: Signal[] = [];
  for (const [talentId, pending] of byTalent) {
    const oldest = Math.min(...pending.map((p) => p.createdAt));
    const daysSinceOldest = Math.floor((Date.now() / 1000 - oldest) / 86400);
    signals.push({
      type: "pending_licences",
      data: {
        talentId,
        talentName: nameMap.get(talentId) ?? "Unknown",
        count: pending.length,
        oldestDaysAgo: daysSinceOldest,
        licences: pending.map((p) => ({
          id: p.id,
          projectName: p.projectName,
          productionCompany: p.productionCompany,
          licenceType: p.licenceType,
          proposedFee: p.proposedFee,
        })),
      },
    });
  }
  return signals;
}

export async function getExpiringNoDownloadSignals(db: Db, repId: string): Promise<Signal[]> {
  const talentIds = await getTalentIdsForRep(db, repId);
  if (talentIds.length === 0) return [];

  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysFromNow = now + 30 * 86400;

  const rows = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      licenseeId: licences.licenseeId,
      validTo: licences.validTo,
      downloadCount: licences.downloadCount,
      agreedFee: licences.agreedFee,
    })
    .from(licences)
    .where(
      and(
        inArray(licences.talentId, talentIds),
        eq(licences.status, "APPROVED"),
        sql`valid_to < ${thirtyDaysFromNow}`,
        sql`valid_to > ${now}`,
        eq(licences.downloadCount, 0)
      )
    )
    .all();

  if (rows.length === 0) return [];

  // Get licensee contact info
  const licenseeIds = [...new Set(rows.map((r) => r.licenseeId))];
  const licensees = await db
    .select({ id: users.id, email: users.email, phone: users.phone })
    .from(users)
    .where(inArray(users.id, licenseeIds))
    .all();
  const licenseeMap = new Map(licensees.map((l) => [l.id, l]));

  // Talent names
  const profiles = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .where(inArray(talentProfiles.userId, talentIds))
    .all();
  const nameMap = new Map(profiles.map((p) => [p.userId, p.fullName]));

  return rows.map((row) => {
    const daysUntilExpiry = Math.floor((row.validTo - now) / 86400);
    const licensee = licenseeMap.get(row.licenseeId);
    return {
      type: "expiring_no_download",
      data: {
        licenceId: row.id,
        talentId: row.talentId,
        talentName: nameMap.get(row.talentId) ?? "Unknown",
        projectName: row.projectName,
        productionCompany: row.productionCompany,
        daysUntilExpiry,
        agreedFee: row.agreedFee,
        licenseeEmail: licensee?.email ?? null,
        licenseePhone: licensee?.phone ?? null,
      },
    };
  });
}

export async function getHighLoginFrequencySignals(db: Db, repId: string): Promise<Signal[]> {
  const talentIds = await getTalentIdsForRep(db, repId);
  if (talentIds.length === 0) return [];

  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;

  // Count refresh token creations in the last 7 days as a proxy for logins
  const rows = await db
    .select({
      userId: refreshTokens.userId,
      loginCount: sql<number>`count(*)`,
    })
    .from(refreshTokens)
    .where(
      and(
        inArray(refreshTokens.userId, talentIds),
        sql`created_at > ${sevenDaysAgo}`
      )
    )
    .groupBy(refreshTokens.userId)
    .all();

  const highFrequency = rows.filter((r) => r.loginCount >= 4);
  if (highFrequency.length === 0) return [];

  const profiles = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .where(inArray(talentProfiles.userId, highFrequency.map((r) => r.userId)))
    .all();
  const nameMap = new Map(profiles.map((p) => [p.userId, p.fullName]));

  return highFrequency.map((row) => ({
    type: "high_login_frequency",
    data: {
      talentId: row.userId,
      talentName: nameMap.get(row.userId) ?? "Unknown",
      loginsThisWeek: row.loginCount,
    },
  }));
}

export async function getRevenueOpportunitySignals(db: Db, repId: string): Promise<Signal[]> {
  const talentIds = await getTalentIdsForRep(db, repId);
  if (talentIds.length === 0) return [];

  // Get pending licences with proposed fees
  const pending = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      licenceType: licences.licenceType,
      territory: licences.territory,
      exclusivity: licences.exclusivity,
      proposedFee: licences.proposedFee,
      projectName: licences.projectName,
    })
    .from(licences)
    .where(
      and(
        inArray(licences.talentId, talentIds),
        eq(licences.status, "PENDING"),
        sql`proposed_fee IS NOT NULL AND proposed_fee > 0`
      )
    )
    .all();

  if (pending.length === 0) return [];

  const signals: Signal[] = [];

  for (const p of pending) {
    if (!p.licenceType) continue;

    // Get historical agreed fees for same licence type
    const comparables = await db
      .select({ agreedFee: licences.agreedFee })
      .from(licences)
      .where(
        and(
          eq(licences.status, "APPROVED"),
          eq(licences.licenceType, p.licenceType),
          sql`agreed_fee IS NOT NULL AND agreed_fee > 0`
        )
      )
      .all();

    if (comparables.length < 3) continue;

    const fees = comparables.map((c) => c.agreedFee!).sort((a, b) => a - b);
    const median = fees[Math.floor(fees.length / 2)];
    const avgFee = Math.round(fees.reduce((s, f) => s + f, 0) / fees.length);

    if (p.proposedFee && p.proposedFee < avgFee * 0.8) {
      const pctBelow = Math.round((1 - p.proposedFee / avgFee) * 100);
      signals.push({
        type: "revenue_opportunity",
        data: {
          licenceId: p.id,
          talentId: p.talentId,
          projectName: p.projectName,
          licenceType: p.licenceType,
          proposedFee: p.proposedFee,
          averageFee: avgFee,
          medianFee: median,
          percentBelow: pctBelow,
          comparableCount: comparables.length,
        },
      });
    }
  }

  return signals;
}

export async function getStalePackageSignals(db: Db, repId: string): Promise<Signal[]> {
  const talentIds = await getTalentIdsForRep(db, repId);
  if (talentIds.length === 0) return [];

  const ninetyDaysAgo = Math.floor(Date.now() / 1000) - 90 * 86400;

  // Packages with no licence activity in 90+ days
  const packages = await db
    .select({
      id: scanPackages.id,
      talentId: scanPackages.talentId,
      name: scanPackages.name,
      createdAt: scanPackages.createdAt,
    })
    .from(scanPackages)
    .where(
      and(
        inArray(scanPackages.talentId, talentIds),
        eq(scanPackages.status, "ready")
      )
    )
    .all();

  if (packages.length === 0) return [];

  const stale: Signal[] = [];
  for (const pkg of packages) {
    const recentLicence = await db
      .select({ id: licences.id })
      .from(licences)
      .where(
        and(
          eq(licences.packageId, pkg.id),
          sql`created_at > ${ninetyDaysAgo}`
        )
      )
      .limit(1)
      .get();

    if (!recentLicence) {
      stale.push({
        type: "stale_package",
        data: {
          packageId: pkg.id,
          talentId: pkg.talentId,
          packageName: pkg.name,
          daysSinceActivity: Math.floor((Date.now() / 1000 - pkg.createdAt) / 86400),
        },
      });
    }
  }

  // Group by talent
  if (stale.length === 0) return [];

  const profiles = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .where(inArray(talentProfiles.userId, talentIds))
    .all();
  const nameMap = new Map(profiles.map((p) => [p.userId, p.fullName]));

  const byTalent = new Map<string, Signal[]>();
  for (const s of stale) {
    const tid = s.data.talentId as string;
    const list = byTalent.get(tid) ?? [];
    list.push(s);
    byTalent.set(tid, list);
  }

  return Array.from(byTalent.entries()).map(([talentId, pkgs]) => ({
    type: "stale_packages",
    data: {
      talentId,
      talentName: nameMap.get(talentId) ?? "Unknown",
      packageCount: pkgs.length,
      packages: pkgs.map((s) => ({
        packageId: s.data.packageId,
        packageName: s.data.packageName,
        daysSinceActivity: s.data.daysSinceActivity,
      })),
    },
  }));
}

export async function getApproachingCapacitySignals(db: Db, repId: string): Promise<Signal[]> {
  const talentIds = await getTalentIdsForRep(db, repId);
  if (talentIds.length === 0) return [];

  const storageRow = await db
    .select({ total: sql<number>`coalesce(sum(${scanFiles.sizeBytes}), 0)` })
    .from(scanFiles)
    .innerJoin(scanPackages, eq(scanFiles.packageId, scanPackages.id))
    .where(
      and(
        inArray(scanPackages.talentId, talentIds),
        eq(scanFiles.uploadStatus, "complete")
      )
    )
    .get();

  const totalBytes = storageRow?.total ?? 0;
  const fiveTB = 5 * 1024 * 1024 * 1024 * 1024;
  const pct = (totalBytes / fiveTB) * 100;

  if (pct >= 75) {
    return [
      {
        type: "approaching_capacity",
        data: {
          totalBytes,
          percentUsed: Math.round(pct),
          tierLimitBytes: fiveTB,
        },
      },
    ];
  }

  return [];
}

export async function gatherSignalsForRep(db: Db, repId: string): Promise<Signal[]> {
  const [pending, expiring, logins, revenue, stale, capacity] = await Promise.all([
    getPendingLicenceSignals(db, repId),
    getExpiringNoDownloadSignals(db, repId),
    getHighLoginFrequencySignals(db, repId),
    getRevenueOpportunitySignals(db, repId),
    getStalePackageSignals(db, repId),
    getApproachingCapacitySignals(db, repId),
  ]);

  return [...pending, ...expiring, ...logins, ...revenue, ...stale, ...capacity];
}
