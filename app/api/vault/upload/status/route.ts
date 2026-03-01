export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, uploadSessions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { eq } from "drizzle-orm";

const CHUNK_SIZE = 52_428_800; // 50 MB

// GET /api/vault/upload/status?packageId={id}
// Returns per-file upload state for a package so the client can resume.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const packageId = new URL(req.url).searchParams.get("packageId");
  if (!packageId) {
    return NextResponse.json({ error: "packageId is required" }, { status: 400 });
  }

  const db = getDb();

  const pkg = await db
    .select({ id: scanPackages.id, talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  const isOwner = pkg?.talentId === session.sub;
  const isRep =
    !!pkg &&
    session.role === "rep" &&
    (await hasRepAccess(session.sub, pkg.talentId));

  if (!pkg || (!isOwner && !isRep)) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  const now = Math.floor(Date.now() / 1000);

  // Join files with their upload sessions (left join — complete files have no session row)
  const rows = await db
    .select({
      fileId: scanFiles.id,
      filename: scanFiles.filename,
      sizeBytes: scanFiles.sizeBytes,
      uploadStatus: scanFiles.uploadStatus,
      completedParts: uploadSessions.completedParts,
      sessionExpiresAt: uploadSessions.expiresAt,
    })
    .from(scanFiles)
    .leftJoin(uploadSessions, eq(uploadSessions.scanFileId, scanFiles.id))
    .where(eq(scanFiles.packageId, packageId))
    .all();

  return NextResponse.json({
    files: rows.map((r) => {
      const parts = r.completedParts
        ? (JSON.parse(r.completedParts) as { partNumber: number; etag: string }[])
        : [];
      const totalParts = Math.ceil(r.sizeBytes / CHUNK_SIZE);
      const hasActiveSession =
        !!r.sessionExpiresAt && r.sessionExpiresAt > now;

      return {
        fileId: r.fileId,
        filename: r.filename,
        sizeBytes: r.sizeBytes,
        uploadStatus: r.uploadStatus,
        completedPartsCount: parts.length,
        totalParts,
        hasActiveSession,
      };
    }),
  });
}
