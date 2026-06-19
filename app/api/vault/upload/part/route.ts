import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanFiles, uploadSessions, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { eq } from "drizzle-orm";

/**
 * PATCH /api/vault/upload/part?fileId=&partNumber=&etag=
 * Records a completed part ETag after the client has uploaded directly to R2
 * via a presigned URL from GET /api/vault/upload/presign.
 */
export async function PATCH(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get("fileId");
  const partNumberStr = searchParams.get("partNumber");
  const etag = searchParams.get("etag");

  if (!fileId || !partNumberStr || !etag) {
    return NextResponse.json(
      { error: "fileId, partNumber, and etag are required" },
      { status: 400 },
    );
  }

  const partNumber = parseInt(partNumberStr, 10);
  if (isNaN(partNumber) || partNumber < 1) {
    return NextResponse.json({ error: "Invalid partNumber" }, { status: 400 });
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

  // Verify ownership
  const file = await db
    .select({ packageId: scanFiles.packageId })
    .from(scanFiles)
    .where(eq(scanFiles.id, fileId))
    .get();

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const pkg = await db
    .select({ talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, file.packageId))
    .get();

  if (!pkg) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  const isOwner = pkg.talentId === session.sub;
  const isRep =
    session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId));

  if (!isOwner && !isRep) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parts: Array<{ partNumber: number; etag: string }> = JSON.parse(
    uploadSession.completedParts,
  );

  // Upsert — replace if same part number (idempotent retry support)
  const idx = parts.findIndex((p) => p.partNumber === partNumber);
  if (idx >= 0) {
    parts[idx] = { partNumber, etag };
  } else {
    parts.push({ partNumber, etag });
  }

  await db
    .update(uploadSessions)
    .set({ completedParts: JSON.stringify(parts) })
    .where(eq(uploadSessions.id, uploadSession.id));

  await db
    .update(scanFiles)
    .set({ uploadStatus: "uploading" })
    .where(eq(scanFiles.id, fileId));

  return NextResponse.json({ ok: true });
}
