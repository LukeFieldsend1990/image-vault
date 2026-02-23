export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { scanFiles, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

// GET /api/vault/files/:id — stream file bytes from R2 to the browser
// Only the owning talent can download their own files via this endpoint.
// Licensee downloads go through the dual-custody flow (Phase 4).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  // Look up the file and verify the owning package belongs to the authed user
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

  const { env } = getRequestContext();
  const object = await env.SCANS_BUCKET.get(file.r2Key);

  if (!object) {
    return NextResponse.json({ error: "File not found in storage" }, { status: 404 });
  }

  const contentType = file.contentType ?? "application/octet-stream";
  const filename = encodeURIComponent(file.filename);

  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `attachment; filename="${file.filename}"; filename*=UTF-8''${filename}`,
      "Cache-Control": "private, no-store",
    },
  });
}
