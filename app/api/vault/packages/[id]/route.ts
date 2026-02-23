export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, uploadSessions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;

  const db = getDb();

  // Verify package belongs to authed user
  const pkg = await db
    .select({ id: scanPackages.id, talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(and(eq(scanPackages.id, id), eq(scanPackages.talentId, session.sub)))
    .get();

  if (!pkg) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
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
