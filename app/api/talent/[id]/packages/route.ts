export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, scanPackages, scanFiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, sql, and, desc } from "drizzle-orm";

// GET /api/talent/[id]/packages — view a talent's ready packages (licensee view, metadata only)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  // Fetch the talent user
  const [talent] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "talent")))
    .limit(1)
    .all();

  if (!talent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fetch ready packages with file counts — no R2 keys exposed
  const packages = await db
    .select({
      id: scanPackages.id,
      name: scanPackages.name,
      description: scanPackages.description,
      captureDate: scanPackages.captureDate,
      studioName: scanPackages.studioName,
      totalSizeBytes: scanPackages.totalSizeBytes,
      status: scanPackages.status,
      createdAt: scanPackages.createdAt,
      fileCount: sql<number>`count(${scanFiles.id})`.as("file_count"),
    })
    .from(scanPackages)
    .leftJoin(scanFiles, and(
      eq(scanFiles.packageId, scanPackages.id),
      eq(scanFiles.uploadStatus, "complete")
    ))
    .where(and(eq(scanPackages.talentId, id), eq(scanPackages.status, "ready")))
    .groupBy(scanPackages.id)
    .orderBy(desc(scanPackages.createdAt))
    .all();

  return NextResponse.json({ talent: { id: talent.id, email: talent.email }, packages });
}
