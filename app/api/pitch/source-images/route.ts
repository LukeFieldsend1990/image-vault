import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { scanFiles, scanPackages, talentReps } from "@/lib/db/schema";
import { eq, and, like } from "drizzle-orm";

// GET /api/pitch/source-images?packageId=<uuid>
// Lists the package's uploaded image files for use as pitch-vignette source frames.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const packageId = req.nextUrl.searchParams.get("packageId");
  if (!packageId) return NextResponse.json({ error: "packageId required" }, { status: 400 });

  const db = getDb();
  const admin = session.role === "admin" || isAdmin(session.email);

  const pkg = await db.select({ talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });

  // Authorise: talent themselves, their rep, or admin
  if (!admin && session.sub !== pkg.talentId) {
    if (session.role !== "rep") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const link = await db.select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, pkg.talentId)))
      .get();
    if (!link) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only completed image uploads are usable as source frames
  const files = await db.select({
    id: scanFiles.id,
    filename: scanFiles.filename,
    r2Key: scanFiles.r2Key,
    sizeBytes: scanFiles.sizeBytes,
    contentType: scanFiles.contentType,
  })
    .from(scanFiles)
    .where(and(
      eq(scanFiles.packageId, packageId),
      eq(scanFiles.uploadStatus, "complete"),
      like(scanFiles.contentType, "image/%"),
    ))
    .all();

  return NextResponse.json({ images: files });
}
