import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { geometryFingerprints, scanFiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";

// GET /api/admin/geometry-fingerprints/download?fingerprintId=xxx&type=original|watermarked
// Admin-only direct download bypassing the licensee dual-custody flow.
// Used to verify watermark was correctly applied by comparing both versions.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const fingerprintId = searchParams.get("fingerprintId");
  const type = searchParams.get("type");

  if (!fingerprintId || (type !== "original" && type !== "watermarked")) {
    return NextResponse.json({ error: "fingerprintId and type (original|watermarked) required" }, { status: 400 });
  }

  const db = getDb();

  const fp = await db
    .select({
      fileId: geometryFingerprints.fileId,
      watermarkedR2Key: geometryFingerprints.watermarkedR2Key,
      status: geometryFingerprints.status,
    })
    .from(geometryFingerprints)
    .where(eq(geometryFingerprints.id, fingerprintId))
    .get();

  if (!fp) return NextResponse.json({ error: "Fingerprint not found" }, { status: 404 });
  if (fp.status !== "ready") return NextResponse.json({ error: "Fingerprint not ready" }, { status: 409 });

  const file = await db
    .select({ filename: scanFiles.filename, r2Key: scanFiles.r2Key })
    .from(scanFiles)
    .where(eq(scanFiles.id, fp.fileId))
    .get();

  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const r2Key = type === "watermarked" ? fp.watermarkedR2Key : file.r2Key;
  const suffix = type === "watermarked" ? "_watermarked" : "_original";
  const downloadName = file.filename.replace(/\.obj$/i, `${suffix}.obj`);

  const { env } = getCloudflareContext();
  const bucket = (env as unknown as { SCANS_BUCKET: R2Bucket }).SCANS_BUCKET;
  const object = await bucket.get(r2Key);

  if (!object) return NextResponse.json({ error: "File not in R2" }, { status: 404 });

  return new NextResponse(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Content-Length": String(object.size),
    },
  });
}
