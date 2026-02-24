export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, uploadSessions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { eq, and, asc } from "drizzle-orm";

// GET /api/vault/packages/:id/files — list files in a package
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const pkg = await db
    .select({ id: scanPackages.id, talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, id))
    .get();

  if (!pkg) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  // Allow talent owner or a delegated rep
  if (pkg.talentId !== session.sub) {
    const allowed =
      (session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId))) ||
      session.role === "admin";
    if (!allowed) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }
  }

  const files = await db
    .select({
      id: scanFiles.id,
      filename: scanFiles.filename,
      sizeBytes: scanFiles.sizeBytes,
      contentType: scanFiles.contentType,
      uploadStatus: scanFiles.uploadStatus,
      createdAt: scanFiles.createdAt,
    })
    .from(scanFiles)
    .where(eq(scanFiles.packageId, id))
    .orderBy(asc(scanFiles.createdAt))
    .all();

  return NextResponse.json({ files });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;

  const db = getDb();

  // Verify package belongs to authed user (or a delegated rep)
  const pkg = await db
    .select({ id: scanPackages.id, talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, id))
    .get();

  if (!pkg) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  if (pkg.talentId !== session.sub) {
    const allowed =
      (session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId))) ||
      session.role === "admin";
    if (!allowed) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }
  }

  // Abort any open R2 multipart uploads before deleting DB records
  const openSessions = await db
    .select({
      id: uploadSessions.id,
      r2Key: uploadSessions.r2Key,
      r2UploadId: uploadSessions.r2UploadId,
    })
    .from(uploadSessions)
    .innerJoin(scanFiles, eq(scanFiles.id, uploadSessions.scanFileId))
    .where(eq(scanFiles.packageId, id))
    .all();

  const { env } = getRequestContext();

  for (const s of openSessions) {
    try {
      const mu = env.SCANS_BUCKET.resumeMultipartUpload(s.r2Key, s.r2UploadId);
      await mu.abort();
    } catch {
      // Best-effort — ignore if already expired
    }
  }

  // Cascade delete handles scan_files and upload_sessions rows
  await db.delete(scanPackages).where(eq(scanPackages.id, id));

  return NextResponse.json({ ok: true });
}
