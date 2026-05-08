export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getDb } from "@/lib/db";
import { scanFiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";

function cfEnv(key: string): string | undefined {
  try {
    return (getRequestContext().env as unknown as Record<string, string | undefined>)[key];
  } catch {
    return process.env[key];
  }
}

// POST /api/admin/clone-packages/copy-file
// Copies a single R2 object and marks the corresponding scan_file record as complete.
// One call per file keeps each request well within Cloudflare's 30s Worker limit.
// Body: { fileId, sourceKey, destKey }
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { fileId?: string; sourceKey?: string; destKey?: string };
  try {
    body = (await req.json()) as { fileId?: string; sourceKey?: string; destKey?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { fileId, sourceKey, destKey } = body;
  if (!fileId || !sourceKey || !destKey) {
    return NextResponse.json({ error: "fileId, sourceKey, and destKey are required" }, { status: 400 });
  }

  // Verify the file record exists (basic security check)
  const db = getDb();
  const file = await db
    .select({ id: scanFiles.id })
    .from(scanFiles)
    .where(eq(scanFiles.id, fileId))
    .get();
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const accountId = cfEnv("CF_ACCOUNT_ID")!;
  const bucket = cfEnv("R2_BUCKET_NAME") ?? "image-vault-scans";
  const r2 = new AwsClient({
    accessKeyId: cfEnv("R2_ACCESS_KEY_ID")!,
    secretAccessKey: cfEnv("R2_SECRET_ACCESS_KEY")!,
    region: "auto",
    service: "s3",
  });

  // x-amz-copy-source must use literal slashes — only encode non-slash characters
  const encodedSource = sourceKey.split("/").map(encodeURIComponent).join("/");
  const url = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${destKey}`;
  const signed = await r2.sign(
    new Request(url, {
      method: "PUT",
      headers: { "x-amz-copy-source": `/${bucket}/${encodedSource}` },
    }),
  );
  const copyRes = await fetch(signed);

  if (!copyRes.ok) {
    const body = await copyRes.text();
    return NextResponse.json(
      { error: `R2 copy failed: ${copyRes.status} ${body.slice(0, 200)}` },
      { status: 502 },
    );
  }

  // Mark file as complete
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(scanFiles)
    .set({ uploadStatus: "complete", completedAt: now })
    .where(eq(scanFiles.id, fileId));

  // Mark package as ready once all files for it are complete (best-effort, non-fatal)
  try {
    const { scanPackages } = await import("@/lib/db/schema");
    const { and, eq: deq, ne } = await import("drizzle-orm");
    const fileRow = await db.select({ packageId: scanFiles.packageId }).from(scanFiles).where(deq(scanFiles.id, fileId)).get();
    if (fileRow) {
      const pending = await db.select({ id: scanFiles.id }).from(scanFiles)
        .where(and(deq(scanFiles.packageId, fileRow.packageId), ne(scanFiles.uploadStatus, "complete")))
        .get();
      if (!pending) {
        await db.update(scanPackages)
          .set({ status: "ready", updatedAt: now })
          .where(deq(scanPackages.id, fileRow.packageId));
      }
    }
  } catch {
    // Non-fatal — package status can be corrected manually
  }

  return NextResponse.json({ ok: true });
}
