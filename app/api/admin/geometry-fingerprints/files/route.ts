export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanFiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, and, sql } from "drizzle-orm";

// GET /api/admin/geometry-fingerprints/files?packageId=xxx
// Returns OBJ files for a package (admin only) for the detection UI dropdown.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const packageId = req.nextUrl.searchParams.get("packageId");
  if (!packageId) {
    return NextResponse.json({ error: "packageId is required" }, { status: 400 });
  }

  const db = getDb();
  const files = await db
    .select({ id: scanFiles.id, filename: scanFiles.filename })
    .from(scanFiles)
    .where(
      and(
        eq(scanFiles.packageId, packageId),
        eq(scanFiles.uploadStatus, "complete"),
        sql`lower(filename) like '%.obj'`,
      ),
    )
    .all();

  return NextResponse.json({ files });
}
