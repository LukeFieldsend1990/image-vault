export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, uploadSessions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, sql, and } from "drizzle-orm";

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
  const accountId = process.env.CF_ACCOUNT_ID!;
  const bucketName = process.env.R2_BUCKET_NAME ?? "image-vault-scans";

  const r2 = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
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

  // Update scan_file status
  await db
    .update(scanFiles)
    .set({ uploadStatus: "complete" })
    .where(eq(scanFiles.id, fileId));

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

    await db
      .update(scanPackages)
      .set({
        totalSizeBytes: sizeResult?.total ?? 0,
        status: allComplete ? "ready" : "uploading",
        updatedAt: now,
      })
      .where(eq(scanPackages.id, packageId));
  }

  return NextResponse.json({ ok: true });
}
