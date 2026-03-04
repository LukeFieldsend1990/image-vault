export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getDb } from "@/lib/db";
import { scanFiles, uploadSessions, scanPackages } from "@/lib/db/schema";
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

const PRESIGN_TTL = 900; // 15 minutes per part

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get("fileId");
  const partNumberStr = searchParams.get("partNumber");

  if (!fileId || !partNumberStr) {
    return NextResponse.json({ error: "fileId and partNumber are required" }, { status: 400 });
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

  // Verify ownership — talent or delegated rep
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

  const accountId = cfEnv("CF_ACCOUNT_ID")!;
  const bucketName = cfEnv("R2_BUCKET_NAME") ?? "image-vault-scans";

  const r2 = new AwsClient({
    accessKeyId: cfEnv("R2_ACCESS_KEY_ID")!,
    secretAccessKey: cfEnv("R2_SECRET_ACCESS_KEY")!,
    region: "auto",
    service: "s3",
  });

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const partUrl = new URL(`${endpoint}/${bucketName}/${uploadSession.r2Key}`);
  partUrl.searchParams.set("partNumber", String(partNumber));
  partUrl.searchParams.set("uploadId", uploadSession.r2UploadId);
  // X-Amz-Expires must be set on the URL before signing when using query-string auth
  partUrl.searchParams.set("X-Amz-Expires", String(PRESIGN_TTL));

  const signedReq = await r2.sign(
    new Request(partUrl.toString(), { method: "PUT" }),
    { aws: { signQuery: true } },
  );

  return NextResponse.json({ url: signedReq.url, expiresIn: PRESIGN_TTL });
}
