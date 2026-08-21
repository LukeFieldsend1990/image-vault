import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { trialReferencePhotos, trialScans } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isScoutRole } from "@/lib/auth/roles";
import { getTrialDetail } from "@/lib/monitor/trial";
import { and, eq } from "drizzle-orm";

// GET /api/scout/:id — trial detail and the poll target while running.
// Scoped to the requester: another account's trial is a 404, not a 403.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isScoutRole(session.role) && !isAdmin(session.email)) {
    return NextResponse.json({ error: "Trial sweeps are for rep and production accounts" }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();
  const detail = await getTrialDetail(db, id, session.sub);
  if (!detail) return NextResponse.json({ error: "Trial not found" }, { status: 404 });
  return NextResponse.json(detail);
}

// DELETE /api/scout/:id — discard a draft (and its uploaded reference
// material). Launched trials are the account's run history and stay.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isScoutRole(session.role) && !isAdmin(session.email)) {
    return NextResponse.json({ error: "Trial sweeps are for rep and production accounts" }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();
  const trial = await db
    .select({ id: trialScans.id, status: trialScans.status })
    .from(trialScans)
    .where(and(eq(trialScans.id, id), eq(trialScans.requestedBy, session.sub)))
    .get();
  if (!trial) return NextResponse.json({ error: "Trial not found" }, { status: 404 });
  if (trial.status !== "draft") {
    return NextResponse.json({ error: "Only draft trials can be deleted" }, { status: 409 });
  }

  // Best-effort R2 cleanup before the rows cascade away.
  const photos = await db
    .select({ r2Key: trialReferencePhotos.r2Key })
    .from(trialReferencePhotos)
    .where(eq(trialReferencePhotos.trialId, id))
    .all();
  try {
    const bucket = (getCloudflareContext().env as unknown as { SCANS_BUCKET?: R2Bucket }).SCANS_BUCKET;
    if (bucket) {
      await Promise.all(photos.map((p) => bucket.delete(p.r2Key).catch(() => {})));
    }
  } catch {
    // local dev without bindings — rows still go, orphaned objects are benign
  }

  await db.delete(trialScans).where(eq(trialScans.id, id));
  return NextResponse.json({ ok: true });
}
