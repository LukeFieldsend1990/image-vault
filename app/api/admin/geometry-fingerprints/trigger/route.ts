export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, geometryFingerprintJobs, users } from "@/lib/db/schema";
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

  // Check no ready job already exists
  const existing = await db
    .select({ id: geometryFingerprintJobs.id, status: geometryFingerprintJobs.status })
    .from(geometryFingerprintJobs)
    .where(eq(geometryFingerprintJobs.licenceId, body.licenceId))
    .get();

  // Re-queue existing non-failed jobs (handles timing miss: row inserted but message never sent)
  const jobId = existing && existing.status !== "failed" ? existing.id : crypto.randomUUID();

  if (!existing || existing.status === "failed") {
    const now = Math.floor(Date.now() / 1000);
    await db.insert(geometryFingerprintJobs).values({
      id: jobId,
      licenceId: body.licenceId,
      packageId: licence.packageId,
      status: "queued",
      filesDone: 0,
      createdAt: now,
    });
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

  return NextResponse.json({ ok: true, jobId, requeued: !!(existing && existing.status !== "failed") });
}
