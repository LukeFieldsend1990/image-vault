export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { and, eq } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";

function cfEnv(key: string): string | undefined {
  try {
    return (getRequestContext().env as unknown as Record<string, string | undefined>)[key];
  } catch {
    return process.env[key];
  }
}

const COVER_TTL = 300; // 5-minute presigned URL

// GET — redirect to a presigned URL for the cover image
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId } = await params;
  const db = getDb();

  const pkg = await db
    .select({ talentId: scanPackages.talentId, coverImageKey: scanPackages.coverImageKey })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg?.coverImageKey) {
    return NextResponse.json({ error: "No cover image set" }, { status: 404 });
  }

  const isOwner = pkg.talentId === session.sub;
  const isRep = session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId));
  const isAdmin = session.role === "admin";
  if (!isOwner && !isRep && !isAdmin && session.role !== "licensee") {
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

  const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${pkg.coverImageKey}`);
  url.searchParams.set("X-Amz-Expires", String(COVER_TTL));
  const signed = await r2.sign(new Request(url.toString(), { method: "GET" }), { aws: { signQuery: true } });

  return NextResponse.redirect(signed.url, { status: 302 });
}

// PATCH — set cover_image_key for this package
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId } = await params;
  const db = getDb();

  const pkg = await db
    .select({ talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = pkg.talentId === session.sub;
  const isRep = session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId));
  if (!isOwner && !isRep && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { fileKey?: string };
  try {
    body = await req.json() as { fileKey?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.fileKey) {
    return NextResponse.json({ error: "fileKey required" }, { status: 400 });
  }

  // Verify the file belongs to this package
  const file = await db
    .select({ id: scanFiles.id })
    .from(scanFiles)
    .where(and(eq(scanFiles.packageId, packageId), eq(scanFiles.r2Key, body.fileKey)))
    .get();

  if (!file) {
    return NextResponse.json({ error: "File not found in package" }, { status: 404 });
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(scanPackages)
    .set({ coverImageKey: body.fileKey, updatedAt: now })
    .where(eq(scanPackages.id, packageId));

  return NextResponse.json({ ok: true });
}
