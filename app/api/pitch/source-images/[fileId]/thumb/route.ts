import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { scanFiles, scanPackages, talentReps } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// GET /api/pitch/source-images/:fileId/thumb
// Streams a package image so reps can preview/pick source frames for a vignette.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { fileId } = await params;
  const db = getDb();

  const file = await db.select({
    r2Key: scanFiles.r2Key,
    contentType: scanFiles.contentType,
    talentId: scanPackages.talentId,
  })
    .from(scanFiles)
    .innerJoin(scanPackages, eq(scanFiles.packageId, scanPackages.id))
    .where(eq(scanFiles.id, fileId))
    .get();

  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Authorise: talent themselves, their rep, or admin
  const admin = session.role === "admin" || isAdmin(session.email);
  if (!admin && session.sub !== file.talentId) {
    if (session.role !== "rep") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const link = await db.select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, file.talentId)))
      .get();
    if (!link) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { env } = getCloudflareContext();
  const bucket = (env as unknown as { SCANS_BUCKET: R2Bucket }).SCANS_BUCKET;

  const obj = await bucket.get(file.r2Key);
  if (!obj) return NextResponse.json({ error: "File not found" }, { status: 404 });

  return new NextResponse(obj.body, {
    headers: {
      "Content-Type": file.contentType ?? "image/jpeg",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
      ...(obj.size ? { "Content-Length": String(obj.size) } : {}),
    },
  });
}
