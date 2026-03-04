export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, uploadSessions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { eq } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";

function cfEnv(key: string): string | undefined {
  try {
    return (getRequestContext().env as unknown as Record<string, string | undefined>)[key];
  } catch {
    return process.env[key];
  }
}

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

  const pkg = await db
    .select({ id: scanPackages.id, talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  const isOwner = pkg?.talentId === session.sub;
  const isRep =
    !!pkg && session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId));

  if (!pkg || (!isOwner && !isRep)) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  const fileId = crypto.randomUUID();
  const r2Key = `scans/${session.sub}/${packageId}/${fileId}/${filename}`;
  const now = Math.floor(Date.now() / 1000);

  // Initiate multipart upload via S3 API so the uploadId is compatible
  // with the presigned part URLs (both use the same S3 namespace)
  const accountId = cfEnv("CF_ACCOUNT_ID")!;
  const bucketName = cfEnv("R2_BUCKET_NAME") ?? "image-vault-scans";

  const r2 = new AwsClient({
    accessKeyId: cfEnv("R2_ACCESS_KEY_ID")!,
    secretAccessKey: cfEnv("R2_SECRET_ACCESS_KEY")!,
    region: "auto",
    service: "s3",
  });

  const initiateUrl = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${r2Key}?uploads`;
  const initiateReq = await r2.sign(
    new Request(initiateUrl, {
      method: "POST",
      headers: contentType ? { "Content-Type": contentType } : {},
    })
  );

  const initiateRes = await fetch(initiateReq);
  if (!initiateRes.ok) {
    const text = await initiateRes.text();
    return NextResponse.json(
      { error: `Failed to initiate multipart upload: ${text}` },
      { status: 502 }
    );
  }

  const xml = await initiateRes.text();
  const uploadIdMatch = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!uploadIdMatch) {
    return NextResponse.json({ error: "Failed to parse upload ID from R2" }, { status: 502 });
  }
  const uploadId = uploadIdMatch[1];

  // Create DB records
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

  const uploadSessionId = crypto.randomUUID();
  await db.insert(uploadSessions).values({
    id: uploadSessionId,
    scanFileId: fileId,
    r2UploadId: uploadId,
    r2Key,
    completedParts: "[]",
    expiresAt: now + 86_400,
    createdAt: now,
  });

  return NextResponse.json({
    fileId,
    uploadSessionId,
    chunkSize: CHUNK_SIZE,
  });
}
