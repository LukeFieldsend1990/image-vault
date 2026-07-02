import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { scanFiles, uploadSessions, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";
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

  // Verify ownership before aborting anyone's in-flight upload (destructive)
  const ownerFile = await db
    .select({ packageId: scanFiles.packageId })
    .from(scanFiles)
    .where(eq(scanFiles.id, fileId))
    .get();
  if (!ownerFile) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  const ownerPkg = await db
    .select({ talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, ownerFile.packageId))
    .get();
  if (!ownerPkg) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }
  const isOwner = ownerPkg.talentId === session.sub;
  const isRep = session.role === "rep" && (await hasRepAccess(session.sub, ownerPkg.talentId));
  if (!isOwner && !isRep && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { env } = getCloudflareContext();
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
