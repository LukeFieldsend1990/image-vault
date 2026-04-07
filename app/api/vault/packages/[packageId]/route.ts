export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { eq, asc } from "drizzle-orm";

// GET /api/vault/packages/:packageId/files — list files in a package
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId } = await params;
  const db = getDb();

  const pkg = await db
    .select({ id: scanPackages.id, talentId: scanPackages.talentId, deletedAt: scanPackages.deletedAt })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg || pkg.deletedAt) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  // Allow talent owner or a delegated rep
  if (pkg.talentId !== session.sub) {
    const allowed =
      (session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId))) ||
      session.role === "admin";
    if (!allowed) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }
  }

  const files = await db
    .select({
      id: scanFiles.id,
      filename: scanFiles.filename,
      sizeBytes: scanFiles.sizeBytes,
      contentType: scanFiles.contentType,
      uploadStatus: scanFiles.uploadStatus,
      createdAt: scanFiles.createdAt,
    })
    .from(scanFiles)
    .where(eq(scanFiles.packageId, packageId))
    .orderBy(asc(scanFiles.createdAt))
    .all();

  return NextResponse.json({ files });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId } = await params;

  const db = getDb();

  // Verify package belongs to authed user (or a delegated rep)
  const pkg = await db
    .select({ id: scanPackages.id, talentId: scanPackages.talentId, deletedAt: scanPackages.deletedAt })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg || pkg.deletedAt) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  if (pkg.talentId !== session.sub) {
    const allowed =
      (session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId))) ||
      session.role === "admin";
    if (!allowed) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }
  }

  const now = Math.floor(Date.now() / 1000);

  // Soft-delete: set deletedAt + deletedBy instead of removing the row
  await db
    .update(scanPackages)
    .set({ deletedAt: now, deletedBy: session.sub, updatedAt: now })
    .where(eq(scanPackages.id, packageId));

  return NextResponse.json({ ok: true });
}
