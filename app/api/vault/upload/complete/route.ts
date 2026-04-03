export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, uploadSessions, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, sql, and } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";

function cfEnv(key: string): string | undefined {
  try {
    return (getRequestContext().env as unknown as Record<string, string | undefined>)[key];
  } catch {
    return process.env[key];
  }
}
import { sendEmail } from "@/lib/email/send";
import { uploadCompleteEmail } from "@/lib/email/templates";
import { triggerAiService } from "@/lib/ai/service";

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

  // Update scan_file status + record completion time
  const completedAt = Math.floor(Date.now() / 1000);
  await db
    .update(scanFiles)
    .set({ uploadStatus: "complete", completedAt })
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
    const totalBytes = sizeResult?.total ?? 0;

    await db
      .update(scanPackages)
      .set({
        totalSizeBytes: totalBytes,
        status: allComplete ? "ready" : "uploading",
        updatedAt: now,
      })
      .where(eq(scanPackages.id, packageId));

    // When all files are done, notify the talent
    if (allComplete) {
      void (async () => {
        const [pkg, talentUser] = await Promise.all([
          db.select({ name: scanPackages.name, talentId: scanPackages.talentId, fileCount: sql<number>`(SELECT count(*) FROM scan_files WHERE package_id = ${packageId} AND upload_status = 'complete')` })
            .from(scanPackages).where(eq(scanPackages.id, packageId)).get(),
          db.select({ email: users.email }).from(users).where(eq(users.id, session.sub)).get(),
        ]);
        if (!talentUser?.email || !pkg) return;
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
        const { subject, html } = uploadCompleteEmail({
          talentEmail: talentUser.email,
          packageName: pkg.name,
          fileCount: pkg.fileCount,
          totalSizeBytes: totalBytes,
          vaultUrl: `${baseUrl}/dashboard`,
        });
        await sendEmail({ to: talentUser.email, subject, html });
      })();

      const { ctx } = getRequestContext();
      ctx.waitUntil(
        triggerAiService(req, `/package-tags/auto/${packageId}`, {
          method: "POST",
          headers: {
            "x-ai-source": "upload-complete",
          },
        }).catch(() => {
          // non-fatal
        })
      );
    }
  }

  return NextResponse.json({ ok: true });
}
