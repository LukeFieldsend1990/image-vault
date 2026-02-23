export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, uploadSessions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

const CHUNK_SIZE = 52_428_800; // 50 MB

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: {
    packageId?: string;
    filename?: string;
    sizeBytes?: number;
    contentType?: string;
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { packageId, filename, sizeBytes, contentType } = body;
  if (!packageId || !filename || sizeBytes == null) {
    return NextResponse.json(
      { error: "packageId, filename, and sizeBytes are required" },
      { status: 400 }
    );
  }

  const db = getDb();

  // Verify package belongs to authed user
  const pkg = await db
    .select({ id: scanPackages.id, talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg || pkg.talentId !== session.sub) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  const fileId = crypto.randomUUID();
  const r2Key = `scans/${session.sub}/${packageId}/${fileId}/${filename}`;
  const now = Math.floor(Date.now() / 1000);

  // Create scan_file record
  await db.insert(scanFiles).values({
    id: fileId,
    packageId,
    filename,
    sizeBytes,
    r2Key,
    contentType: contentType ?? null,
    uploadStatus: "pending",
    createdAt: now,
  });

  // Initiate R2 multipart upload
  const { env } = getRequestContext();
  const multipartUpload = await env.SCANS_BUCKET.createMultipartUpload(r2Key, {
    httpMetadata: contentType ? { contentType } : undefined,
  });

  const uploadSessionId = crypto.randomUUID();

  await db.insert(uploadSessions).values({
    id: uploadSessionId,
    scanFileId: fileId,
    r2UploadId: multipartUpload.uploadId,
    r2Key,
    completedParts: "[]",
    expiresAt: now + 86_400, // 24 h
    createdAt: now,
  });

  return NextResponse.json({
    fileId,
    uploadSessionId,
    chunkSize: CHUNK_SIZE,
  });
}
