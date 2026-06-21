/**
 * Production-included licences.
 *
 * Sometimes a scan is commissioned and paid for as part of the production
 * itself — the talent isn't paid (and no commercial happens) through Image
 * Vault. Such a licence has a £0 fee and does NOT count as a re-licence.
 *
 * We don't block marking a licence as included, but we guard against abuse:
 * if the package/talent has prior usage through the platform (a prior licence,
 * or a download), the inclusion is recorded with the full prior-usage detail
 * and flagged for admin review.
 */

import { eq, inArray } from "drizzle-orm";
import {
  licences, downloadEvents, scanFiles, productionInclusionRecords, users,
} from "@/lib/db/schema";
import { ADMIN_EMAILS } from "@/lib/auth/adminEmails";
import { createNotification } from "@/lib/notifications/create";
import { sendEmail } from "@/lib/email/send";
import { inclusionFlaggedEmail } from "@/lib/email/templates";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface PriorUsage {
  priorLicenceCount: number;
  priorDownloadCount: number;
  flagged: boolean;
  detail: {
    licences: { id: string; shortCode: string | null; status: string; productionId: string | null; createdAt: number }[];
    downloadCount: number;
  };
}

/**
 * Detect prior platform usage for a talent's package — the abuse signal for an
 * inclusion claim. "Prior" = any other licence on the same package (excluding the
 * licence being marked, and excluding other production-included grants for the
 * same production), or any download recorded against the package's files.
 */
export async function computePriorUsage(
  db: Db,
  opts: { licenceId: string; packageId: string | null; talentId: string; productionId: string | null },
): Promise<PriorUsage> {
  // Prior licences on the same package (or, if no package yet, on the same talent).
  const rows = await db
    .select({
      id: licences.id,
      shortCode: licences.shortCode,
      status: licences.status,
      productionId: licences.productionId,
      createdAt: licences.createdAt,
      productionIncluded: licences.productionIncluded,
    })
    .from(licences)
    .where(opts.packageId ? eq(licences.packageId, opts.packageId) : eq(licences.talentId, opts.talentId))
    .all();

  const priorLicences = rows.filter((r) => {
    if (r.id === opts.licenceId) return false;
    // Don't count other production-included grants for the same production as
    // "prior commercial usage" — those are part of the same shoot.
    if (r.productionIncluded && r.productionId && r.productionId === opts.productionId) return false;
    return true;
  });

  // Prior downloads against this package's files.
  let priorDownloadCount = 0;
  if (opts.packageId) {
    const fileIds = (await db
      .select({ id: scanFiles.id })
      .from(scanFiles)
      .where(eq(scanFiles.packageId, opts.packageId))
      .all()).map((f) => f.id);
    if (fileIds.length > 0) {
      const dls = await db
        .select({ id: downloadEvents.id })
        .from(downloadEvents)
        .where(inArray(downloadEvents.fileId, fileIds))
        .all();
      priorDownloadCount = dls.length;
    }
  }

  return {
    priorLicenceCount: priorLicences.length,
    priorDownloadCount,
    flagged: priorLicences.length > 0 || priorDownloadCount > 0,
    detail: {
      licences: priorLicences.map((r) => ({ id: r.id, shortCode: r.shortCode, status: r.status, productionId: r.productionId, createdAt: r.createdAt })),
      downloadCount: priorDownloadCount,
    },
  };
}

export interface MarkIncludedResult {
  ok: boolean;
  message: string;
  flagged?: boolean;
}

/**
 * Mark a licence as production-included: zero the fees, record the inclusion
 * with full prior-usage detail, and alert admins if it was flagged.
 */
export async function markLicenceIncluded(
  db: Db,
  opts: { licenceId: string; markedByUserId: string; reason: string; baseUrl: string },
): Promise<MarkIncludedResult> {
  const licence = await db
    .select({
      id: licences.id,
      shortCode: licences.shortCode,
      talentId: licences.talentId,
      packageId: licences.packageId,
      productionId: licences.productionId,
      projectName: licences.projectName,
      productionIncluded: licences.productionIncluded,
    })
    .from(licences)
    .where(eq(licences.id, opts.licenceId))
    .get();
  if (!licence) return { ok: false, message: "Licence not found." };
  if (licence.productionIncluded) return { ok: false, message: "This licence is already marked as production-included." };

  const usage = await computePriorUsage(db, {
    licenceId: licence.id,
    packageId: licence.packageId,
    talentId: licence.talentId,
    productionId: licence.productionId,
  });

  const now = Math.floor(Date.now() / 1000);

  // Zero the commercial terms — included = no fee, no platform cut.
  await db.update(licences).set({
    productionIncluded: true,
    inclusionReason: opts.reason || null,
    inclusionMarkedBy: opts.markedByUserId,
    inclusionMarkedAt: now,
    proposedFee: 0,
    agreedFee: 0,
    platformFee: 0,
  }).where(eq(licences.id, licence.id));

  const recordId = crypto.randomUUID();
  await db.insert(productionInclusionRecords).values({
    id: recordId,
    licenceId: licence.id,
    productionId: licence.productionId,
    packageId: licence.packageId,
    talentId: licence.talentId,
    markedBy: opts.markedByUserId,
    markedAt: now,
    reason: opts.reason || null,
    priorLicenceCount: usage.priorLicenceCount,
    priorDownloadCount: usage.priorDownloadCount,
    priorUsageJson: JSON.stringify(usage.detail),
    flagged: usage.flagged,
  });

  if (usage.flagged) {
    void alertAdminsOfFlaggedInclusion(db, {
      licenceCode: licence.shortCode ?? licence.id,
      projectName: licence.projectName,
      priorLicenceCount: usage.priorLicenceCount,
      priorDownloadCount: usage.priorDownloadCount,
      baseUrl: opts.baseUrl,
    });
  }

  return { ok: true, message: usage.flagged ? "Marked as included — flagged for review (prior usage found)." : "Marked as production-included.", flagged: usage.flagged };
}

async function alertAdminsOfFlaggedInclusion(
  db: Db,
  opts: { licenceCode: string; projectName: string; priorLicenceCount: number; priorDownloadCount: number; baseUrl: string },
): Promise<void> {
  try {
    const admins = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.email, [...ADMIN_EMAILS]))
      .all();

    const summary = `${opts.priorLicenceCount} prior licence(s), ${opts.priorDownloadCount} prior download(s)`;
    const href = "/admin/inclusions";

    await Promise.all(admins.map((a) =>
      createNotification(db, {
        userId: a.id,
        type: "inclusion_flagged",
        title: `Production-included claim flagged — ${opts.projectName}`,
        body: `Licence ${opts.licenceCode} was marked production-included but has prior usage (${summary}). Review.`,
        href,
      }),
    ));

    await Promise.all(admins.map((a) => {
      const { subject, html } = inclusionFlaggedEmail({
        recipientEmail: a.email,
        licenceCode: opts.licenceCode,
        projectName: opts.projectName,
        priorLicenceCount: opts.priorLicenceCount,
        priorDownloadCount: opts.priorDownloadCount,
        reviewUrl: `${opts.baseUrl}${href}`,
      });
      return sendEmail({ to: a.email, subject, html }).catch(() => {});
    }));
  } catch {
    // best-effort
  }
}
