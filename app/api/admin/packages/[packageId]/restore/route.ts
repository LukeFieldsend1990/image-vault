export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq } from "drizzle-orm";

// POST /api/admin/packages/:packageId/restore — restore a soft-deleted package
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { packageId } = await params;
  const db = getDb();

  const pkg = await db
    .select({ id: scanPackages.id, deletedAt: scanPackages.deletedAt })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  if (!pkg.deletedAt) {
    return NextResponse.json({ error: "Package is not deleted" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  await db
    .update(scanPackages)
    .set({ deletedAt: null, deletedBy: null, updatedAt: now })
    .where(eq(scanPackages.id, packageId));

  return NextResponse.json({ ok: true });
}
