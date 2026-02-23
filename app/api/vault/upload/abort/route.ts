export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { scanFiles, uploadSessions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

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

  const { env } = getRequestContext();
  const multipartUpload = env.SCANS_BUCKET.resumeMultipartUpload(
    uploadSession.r2Key,
    uploadSession.r2UploadId
  );

  await multipartUpload.abort();

  await db
    .update(scanFiles)
    .set({ uploadStatus: "error" })
    .where(eq(scanFiles.id, fileId));

  await db
    .delete(uploadSessions)
    .where(eq(uploadSessions.id, uploadSession.id));

  return NextResponse.json({ ok: true });
}
