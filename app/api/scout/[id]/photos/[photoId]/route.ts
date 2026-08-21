import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { trialReferencePhotos, trialScans } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isScoutRole } from "@/lib/auth/roles";
import { and, eq } from "drizzle-orm";

// DELETE /api/scout/:id/photos/:photoId — remove one reference upload from a
// draft trial, R2 object included.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isScoutRole(session.role)) {
    return NextResponse.json({ error: "Trial sweeps are for rep and production accounts" }, { status: 403 });
  }

  const { id, photoId } = await params;
  const db = getDb();
  const trial = await db
    .select({ id: trialScans.id, status: trialScans.status })
    .from(trialScans)
    .where(and(eq(trialScans.id, id), eq(trialScans.requestedBy, session.sub)))
    .get();
  if (!trial) return NextResponse.json({ error: "Trial not found" }, { status: 404 });
  if (trial.status !== "draft") {
    return NextResponse.json({ error: "Reference material is frozen once the sweep runs" }, { status: 409 });
  }

  const photo = await db
    .select({ id: trialReferencePhotos.id, r2Key: trialReferencePhotos.r2Key })
    .from(trialReferencePhotos)
    .where(and(eq(trialReferencePhotos.id, photoId), eq(trialReferencePhotos.trialId, id)))
    .get();
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  try {
    const bucket = (getCloudflareContext().env as unknown as { SCANS_BUCKET?: R2Bucket }).SCANS_BUCKET;
    if (bucket) await bucket.delete(photo.r2Key).catch(() => {});
  } catch {
    // local dev without bindings — row deletion is what matters
  }

  await db.delete(trialReferencePhotos).where(eq(trialReferencePhotos.id, photoId));
  return NextResponse.json({ ok: true });
}
