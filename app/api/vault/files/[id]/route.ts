export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getDb } from "@/lib/db";
import { scanFiles, scanPackages, downloadEvents } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

// GET /api/vault/files/:id — stream file bytes from R2 to the browser.
// Uses the S3 API directly (same path as upload) so dev and prod are consistent.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const file = await db
    .select({
      id: scanFiles.id,
      filename: scanFiles.filename,
      r2Key: scanFiles.r2Key,
      contentType: scanFiles.contentType,
      sizeBytes: scanFiles.sizeBytes,
      uploadStatus: scanFiles.uploadStatus,
      talentId: scanPackages.talentId,
    })
    .from(scanFiles)
    .innerJoin(scanPackages, eq(scanPackages.id, scanFiles.packageId))
    .where(eq(scanFiles.id, id))
    .get();

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (file.talentId !== session.sub) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (file.uploadStatus !== "complete") {
    return NextResponse.json({ error: "File upload is not complete" }, { status: 409 });
  }

  const accountId = process.env.CF_ACCOUNT_ID!;
  const bucketName = process.env.R2_BUCKET_NAME ?? "image-vault-scans";

  const r2 = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    region: "auto",
    service: "s3",
  });

  const objectUrl = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${file.r2Key}`;
  const signedReq = await r2.sign(new Request(objectUrl, { method: "GET" }));
  const r2Res = await fetch(signedReq);

  if (!r2Res.ok) {
    return NextResponse.json({ error: "File not found in storage" }, { status: 404 });
  }

  // Log the talent's own download to the chain of custody
  const now = Math.floor(Date.now() / 1000);
  void db.insert(downloadEvents).values({
    id: crypto.randomUUID(),
    licenceId: null,
    licenseeId: session.sub,
    fileId: file.id,
    ip: req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null,
    userAgent: req.headers.get("user-agent") ?? null,
    bytesTransferred: file.sizeBytes,
    startedAt: now,
    completedAt: now,
  });

  const contentType = file.contentType ?? "application/octet-stream";
  const filename = encodeURIComponent(file.filename);

  return new Response(r2Res.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `attachment; filename="${file.filename}"; filename*=UTF-8''${filename}`,
      "Cache-Control": "private, no-store",
    },
  });
}
