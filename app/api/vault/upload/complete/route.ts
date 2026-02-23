export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
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

  const { env } = getRequestContext();
  const multipartUpload = env.SCANS_BUCKET.resumeMultipartUpload(
    uploadSession.r2Key,
    uploadSession.r2UploadId
  );

  await multipartUpload.complete(parts);

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

    // Sum sizes of all completed files
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

    // Check whether any files are still not complete
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
