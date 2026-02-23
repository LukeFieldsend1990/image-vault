export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { scanFiles, uploadSessions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

export async function PUT(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get("fileId");
  const partNumberStr = searchParams.get("partNumber");

  if (!fileId || !partNumberStr) {
    return NextResponse.json(
      { error: "fileId and partNumber query params are required" },
      { status: 400 }
    );
  }

  const partNumber = parseInt(partNumberStr, 10);
  if (isNaN(partNumber) || partNumber < 1) {
    return NextResponse.json({ error: "Invalid partNumber" }, { status: 400 });
  }

  const db = getDb();

  // Look up upload session and verify file belongs to authed user
  const uploadSession = await db
    .select({
      id: uploadSessions.id,
      r2UploadId: uploadSessions.r2UploadId,
      r2Key: uploadSessions.r2Key,
      completedParts: uploadSessions.completedParts,
      scanFileId: uploadSessions.scanFileId,
    })
    .from(uploadSessions)
    .where(eq(uploadSessions.scanFileId, fileId))
    .get();

  if (!uploadSession) {
    return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
  }

  const { env } = getRequestContext();
  const multipartUpload = env.SCANS_BUCKET.resumeMultipartUpload(
    uploadSession.r2Key,
    uploadSession.r2UploadId
  );

  // R2 uploadPart requires a body with a known length.
  // Buffer the stream into an ArrayBuffer so R2 can determine the size.
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: "No body" }, { status: 400 });
  }

  const uploadedPart = await multipartUpload.uploadPart(partNumber, buffer);

  // Append completed part to JSON array
  const parts: Array<{ partNumber: number; etag: string }> = JSON.parse(
    uploadSession.completedParts
  );
  parts.push({ partNumber, etag: uploadedPart.etag });

  await db
    .update(uploadSessions)
    .set({ completedParts: JSON.stringify(parts) })
    .where(eq(uploadSessions.id, uploadSession.id));

  await db
    .update(scanFiles)
    .set({ uploadStatus: "uploading" })
    .where(eq(scanFiles.id, fileId));

  return NextResponse.json({ etag: uploadedPart.etag, partNumber });
}
