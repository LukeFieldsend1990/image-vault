export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, geometryFingerprintJobs, geometryFingerprints } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { eq } from "drizzle-orm";

// POST /api/admin/geometry-fingerprints/trigger
// Manually enqueue a watermarking job for an already-approved licence.
// Idempotent: won't create a second job if one already exists.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { licenceId?: string } = {};
  try {
    body = JSON.parse(await req.text());
  } catch { /* ok */ }

  if (!body.licenceId) {
    return NextResponse.json({ error: "licenceId is required" }, { status: 400 });
  }

  const db = getDb();

  const [licence] = await db
    .select({ id: licences.id, packageId: licences.packageId, status: licences.status, talentId: licences.talentId })
    .from(licences)
    .where(eq(licences.id, body.licenceId))
    .limit(1)
    .all();

  if (!licence) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  if (licence.status !== "APPROVED") return NextResponse.json({ error: "Licence is not APPROVED" }, { status: 409 });
  if (!licence.packageId) return NextResponse.json({ error: "Licence has no package" }, { status: 409 });

  const existing = await db
    .select({ id: geometryFingerprintJobs.id, status: geometryFingerprintJobs.status })
    .from(geometryFingerprintJobs)
    .where(eq(geometryFingerprintJobs.licenceId, body.licenceId))
    .orderBy(eq(geometryFingerprintJobs.licenceId, body.licenceId)) // most recent via created_at desc would need sql, use get() which returns first
    .get();

  const now = Math.floor(Date.now() / 1000);
  let jobId: string;

  if (!existing) {
    // Fresh job
    jobId = crypto.randomUUID();
    await db.insert(geometryFingerprintJobs).values({
      id: jobId,
      licenceId: body.licenceId,
      packageId: licence.packageId,
      status: "queued",
      filesDone: 0,
      createdAt: now,
    });
  } else if (existing.status === "queued" || existing.status === "processing") {
    // Already in flight — just resend the queue message
    jobId = existing.id;
  } else {
    // complete or failed: reset the existing row so the worker reprocesses it,
    // and wipe its fingerprint rows so they're recreated cleanly
    jobId = existing.id;
    await db.delete(geometryFingerprints).where(eq(geometryFingerprints.jobId, existing.id));
    await db
      .update(geometryFingerprintJobs)
      .set({ status: "queued", filesDone: 0, filesTotal: null, error: null, completedAt: null, createdAt: now })
      .where(eq(geometryFingerprintJobs.id, existing.id));
  }

  try {
    const { env } = getRequestContext();
    const queue = (env as unknown as Record<string, Queue>)["GEO_FINGERPRINT_QUEUE"];
    if (queue) {
      await queue.send({ jobId });
    } else {
      return NextResponse.json({ error: "Queue binding not available" }, { status: 503 });
    }
  } catch (err) {
    return NextResponse.json({ error: "Failed to enqueue job", detail: String(err) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, jobId });
}
