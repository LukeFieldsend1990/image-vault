export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { licences, scanFiles, organisations } from "@/lib/db/schema";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import {
  requireRenderBridgeToken,
  isRenderBridgeTokenError,
} from "@/lib/auth/requireRenderBridgeToken";

const PRESIGN_TTL_SECS = 86400; // 24 h

function cfEnv(key: string): string | undefined {
  try {
    return (getRequestContext().env as unknown as Record<string, string | undefined>)[key];
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
 * Returns all APPROVED, non-expired project-scoped licences for this agent's
 * org + production, with R2 presigned download URLs for each file.
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
    .select({ name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, auth.organisationId))
    .get();

  const projectLicences = await db
    .select({
      id: licences.id,
      packageId: licences.packageId,
      validTo: licences.validTo,
      fileScope: licences.fileScope,
    })
    .from(licences)
    .where(
      and(
        eq(licences.organisationId, auth.organisationId),
        eq(licences.productionId, auth.productionId),
        eq(licences.status, "APPROVED"),
        gt(licences.validTo, now),
        isNotNull(licences.packageId),
      )
    )
    .all();

  if (projectLicences.length === 0) {
    return NextResponse.json({ error: "No active project grant found" }, { status: 404 });
  }

  const packages = await Promise.all(
    projectLicences.map(async (licence) => {
      const allFiles = await db
        .select({
          id: scanFiles.id,
          filename: scanFiles.filename,
          r2Key: scanFiles.r2Key,
          sizeBytes: scanFiles.sizeBytes,
          sha256: scanFiles.sha256,
          uploadStatus: scanFiles.uploadStatus,
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
        grantId: licence.id,
        files,
        expiresAt: licence.validTo,
      };
    })
  );

  const earliestExpiry = Math.min(...projectLicences.map(l => l.validTo));

  return NextResponse.json({
    projectGrantId: `pg_${auth.productionId}`,
    projectId: auth.productionId,
    licenceeOrganisation: org?.name ?? auth.organisationId,
    expiresAt: earliestExpiry,
    packages,
  });
}
