import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { licences, scanFiles, organisations, organisationMembers, vendorAuthorisations } from "@/lib/db/schema";
import { and, eq, gt, inArray, isNotNull, or, sql, lte } from "drizzle-orm";
import {
  requireRenderBridgeToken,
  isRenderBridgeTokenError,
} from "@/lib/auth/requireRenderBridgeToken";
import { beginScrubPeriod } from "@/lib/licences/expire";
import { dedupeFilesByPath } from "@/lib/bridge/manifestFiles";

const PRESIGN_TTL_SECS = 86400; // 24 h

function cfEnv(key: string): string | undefined {
  try {
    return (getCloudflareContext().env as unknown as Record<string, string | undefined>)[key];
  } catch {
    return process.env[key];
  }
}

async function presignGet(r2Key: string, ttlSecs: number): Promise<string> {
  const accountId = cfEnv("CF_ACCOUNT_ID")!;
  const bucketName = cfEnv("R2_BUCKET_NAME") ?? "image-vault-scans";
  const r2 = new AwsClient({
    accessKeyId: cfEnv("R2_ACCESS_KEY_ID")!,
    secretAccessKey: cfEnv("R2_SECRET_ACCESS_KEY")!,
    region: "auto",
    service: "s3",
  });
  const url = new URL(
    `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${r2Key}`
  );
  url.searchParams.set("X-Amz-Expires", String(ttlSecs));
  const signed = await r2.sign(new Request(url.toString(), { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

/**
 * GET /api/bridge/render-bridge/:agentId/project-grant
 *
 * Returns all APPROVED, non-expired licences for this agent's org —
 * both org-scoped licences and licences held by individual org members —
 * with R2 presigned download URLs for each file.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const auth = await requireRenderBridgeToken(req);
  if (isRenderBridgeTokenError(auth)) return auth;

  const { agentId } = await params;
  if (auth.agentId !== agentId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const org = await db
    .select({ name: organisations.name, vendorAuditPassed: organisations.vendorAuditPassed })
    .from(organisations)
    .where(eq(organisations.id, auth.organisationId))
    .get();

  // Collect member user IDs so personal licences are included alongside org-scoped ones
  const memberRows = await db
    .select({ userId: organisationMembers.userId })
    .from(organisationMembers)
    .where(eq(organisationMembers.organisationId, auth.organisationId))
    .all();
  const memberIds = memberRows.map(r => r.userId);

  // Licences this org may pull as an authorised vendor (producer→vendor auth).
  // Gated by the environment-audit flag: no audit, no vendor-authorised access.
  let vendorLicenceIds: string[] = [];
  if (org?.vendorAuditPassed) {
    const vRows = await db
      .select({ licenceId: vendorAuthorisations.licenceId })
      .from(vendorAuthorisations)
      .where(and(eq(vendorAuthorisations.vendorOrgId, auth.organisationId), eq(vendorAuthorisations.status, "active")))
      .all();
    vendorLicenceIds = vRows.map((r) => r.licenceId);
  }

  // An org reaches a licence as the licensee (org-scoped or via a member) OR as an audited authorised vendor.
  const accessClauses = [eq(licences.organisationId, auth.organisationId)];
  if (memberIds.length > 0) accessClauses.push(inArray(licences.licenseeId, memberIds));
  if (vendorLicenceIds.length > 0) accessClauses.push(inArray(licences.id, vendorLicenceIds));

  const licenceFilter = and(
    eq(licences.status, "APPROVED"),
    gt(licences.validTo, now - 86400),
    isNotNull(licences.packageId),
    accessClauses.length > 1 ? or(...accessClauses) : accessClauses[0]
  );

  const activeLicences = await db
    .select({
      id: licences.id,
      packageId: licences.packageId,
      validTo: licences.validTo,
      fileScope: licences.fileScope,
      productionId: licences.productionId,
    })
    .from(licences)
    .where(licenceFilter)
    .all();

  // Transition any APPROVED licences that have just expired into SCRUB_PERIOD.
  // This is the natural trigger point — the bridge already stops serving them
  // via the validTo filter above; here we make that state durable in the DB.
  const expiredOrgFilter = and(
    eq(licences.status, "APPROVED"),
    lte(licences.validTo, sql`${now} - 86400`),
    isNotNull(licences.packageId),
    memberIds.length > 0
      ? or(
          eq(licences.organisationId, auth.organisationId),
          inArray(licences.licenseeId, memberIds)
        )
      : eq(licences.organisationId, auth.organisationId)
  );
  const justExpired = await db
    .select({ id: licences.id })
    .from(licences)
    .where(expiredOrgFilter)
    .all();
  for (const { id } of justExpired) {
    void beginScrubPeriod(db, id, now);
  }

  if (activeLicences.length === 0) {
    return NextResponse.json({ error: "No active licences found for this organisation" }, { status: 404 });
  }

  const packages = await Promise.all(
    activeLicences.map(async (licence) => {
      const allFiles = await db
        .select({
          id: scanFiles.id,
          filename: scanFiles.filename,
          r2Key: scanFiles.r2Key,
          sizeBytes: scanFiles.sizeBytes,
          sha256: scanFiles.sha256,
          uploadStatus: scanFiles.uploadStatus,
          completedAt: scanFiles.completedAt,
          createdAt: scanFiles.createdAt,
        })
        .from(scanFiles)
        .where(eq(scanFiles.packageId, licence.packageId!))
        .all();

      const completedFiles = allFiles.filter(f => f.uploadStatus === "complete");

      let scopedFiles = completedFiles;
      if (licence.fileScope && licence.fileScope !== "all") {
        try {
          const scopeIds = JSON.parse(licence.fileScope) as string[];
          scopedFiles = completedFiles.filter(f => scopeIds.includes(f.id));
        } catch {
          // malformed fileScope — fall back to all completed files
        }
      }

      // A re-uploaded file leaves more than one completed row at the same
      // filename; emitting both at the same manifest `path` makes the bridge's
      // integrity map non-deterministic and triggers false tamper events.
      // Collapse each path to its canonical (latest completed) row.
      scopedFiles = dedupeFilesByPath(scopedFiles);

      const files = await Promise.all(
        scopedFiles.map(async (f) => ({
          fileId: f.id,
          filename: f.filename,
          path: f.filename,
          size: f.sizeBytes,
          sha256: f.sha256 ?? null,
          sourceUrl: await presignGet(f.r2Key, PRESIGN_TTL_SECS),
        }))
      );

      return {
        packageId: licence.packageId,
        licenceId: licence.id,
        productionId: licence.productionId ?? null,
        files,
        expiresAt: licence.validTo + 86400,
      };
    })
  );

  const earliestExpiry = Math.min(...activeLicences.map(l => l.validTo));

  return NextResponse.json({
    organisationId: auth.organisationId,
    licenceeOrganisation: org?.name ?? auth.organisationId,
    expiresAt: earliestExpiry + 86400,
    packages,
  });
}
