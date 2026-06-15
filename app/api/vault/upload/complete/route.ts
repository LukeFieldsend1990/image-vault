export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, uploadSessions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, sql, and } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { sha256HexFromStream } from "@/lib/crypto/hash";

function cfEnv(key: string): string | undefined {
  try {
    return (getRequestContext().env as unknown as Record<string, string | undefined>)[key];
  } catch {
    return process.env[key];
  }
}


export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { fileId?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { fileId } = body;
  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const db = getDb();

  const uploadSession = await db
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.scanFileId, fileId))
    .get();

  if (!uploadSession) {
    return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
  }

  const parts: Array<{ partNumber: number; etag: string }> = JSON.parse(
    uploadSession.completedParts
  );

  // Sort parts ascending — S3 requires this
  parts.sort((a, b) => a.partNumber - b.partNumber);

  // Complete multipart upload via S3 API (matches the presigned part uploads)
  const accountId = cfEnv("CF_ACCOUNT_ID")!;
  const bucketName = cfEnv("R2_BUCKET_NAME") ?? "image-vault-scans";

  const r2 = new AwsClient({
    accessKeyId: cfEnv("R2_ACCESS_KEY_ID")!,
    secretAccessKey: cfEnv("R2_SECRET_ACCESS_KEY")!,
    region: "auto",
    service: "s3",
  });

  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<CompleteMultipartUpload>",
    ...parts.map(
      (p) =>
        `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${
          // Ensure ETag is quoted as S3 requires
          p.etag.startsWith('"') ? p.etag : `"${p.etag}"`
        }</ETag></Part>`
    ),
    "</CompleteMultipartUpload>",
  ].join("");

  const completeUrl = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${uploadSession.r2Key}?uploadId=${encodeURIComponent(uploadSession.r2UploadId)}`;

  const completeReq = await r2.sign(
    new Request(completeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: xmlBody,
    })
  );

  const completeRes = await fetch(completeReq);
  if (!completeRes.ok) {
    const text = await completeRes.text();
    return NextResponse.json(
      { error: `Failed to complete multipart upload: ${text}` },
      { status: 502 }
    );
  }

  // Reconcile size_bytes to the *confirmed* R2 object size. The value stored at
  // initiate is client-declared and may differ from the bytes actually stored;
  // the render bridge compares this against the file it downloads, so a stale
  // value produces false tamper_detected events. A HEAD is a cheap metadata
  // call, so we do it inline before recomputing the package total below.
  const { ctx, env } = getRequestContext();
  let confirmedSize: number | null = null;
  try {
    const head = await env.SCANS_BUCKET.head(uploadSession.r2Key);
    if (head) confirmedSize = head.size;
  } catch {
    // R2 HEAD unavailable — keep the client-declared size as a best effort.
  }

  // Update scan_file status + record completion time
  const completedAt = Math.floor(Date.now() / 1000);
  await db
    .update(scanFiles)
    .set({
      uploadStatus: "complete",
      completedAt,
      ...(confirmedSize !== null ? { sizeBytes: confirmedSize } : {}),
    })
    .where(eq(scanFiles.id, fileId));

  // Compute the SHA-256 of the stored object so the render-bridge grant
  // manifest can carry an authoritative content hash (the bridge verifies
  // cached files against it instead of falling back to a size-only check).
  // Streamed via crypto.DigestStream so large scans aren't buffered in memory,
  // and done after the response so the upload loop isn't blocked.
  ctx.waitUntil(
    (async () => {
      try {
        const obj = await env.SCANS_BUCKET.get(uploadSession.r2Key);
        if (!obj?.body) return;
        const sha256 = await sha256HexFromStream(obj.body);
        await db
          .update(scanFiles)
          .set({ sha256 })
          .where(eq(scanFiles.id, fileId));
      } catch {
        // Leave sha256 null — the bridge gracefully falls back to size check.
      }
    })()
  );

  // Remove upload session
  await db
    .delete(uploadSessions)
    .where(eq(uploadSessions.id, uploadSession.id));

  // Recalculate package total size and status
  const file = await db
    .select({ packageId: scanFiles.packageId })
    .from(scanFiles)
    .where(eq(scanFiles.id, fileId))
    .get();

  if (file) {
    const { packageId } = file;
    const now = Math.floor(Date.now() / 1000);

    const sizeResult = await db
      .select({ total: sql<number>`sum(size_bytes)` })
      .from(scanFiles)
      .where(
        and(
          eq(scanFiles.packageId, packageId),
          eq(scanFiles.uploadStatus, "complete")
        )
      )
      .get();

    const pendingResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(scanFiles)
      .where(
        and(
          eq(scanFiles.packageId, packageId),
          sql`upload_status != 'complete'`
        )
      )
      .get();

    const allComplete = (pendingResult?.count ?? 0) === 0;
    const totalBytes = sizeResult?.total ?? 0;

    await db
      .update(scanPackages)
      .set({
        totalSizeBytes: totalBytes,
        status: allComplete ? "ready" : "uploading",
        updatedAt: now,
      })
      .where(eq(scanPackages.id, packageId));

  }

  return NextResponse.json({ ok: true });
}
