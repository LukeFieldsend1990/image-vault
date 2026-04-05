export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pipelineJobs, pipelineStages, scanPackages, talentSettings } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, desc, sql } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";

const STAGE_NAMES = ["validate", "classify", "assemble", "bundle", "notify"] as const;

// GET /api/pipeline/jobs — list jobs (talent: own; admin: all)
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const admin = session.role === "admin" || isAdmin(session.email);

  const jobs = admin
    ? await db.select().from(pipelineJobs).orderBy(desc(pipelineJobs.createdAt)).all()
    : await db.select().from(pipelineJobs)
        .where(eq(pipelineJobs.talentId, session.sub))
        .orderBy(desc(pipelineJobs.createdAt))
        .all();

  return NextResponse.json({ jobs });
}

// POST /api/pipeline/jobs — create + enqueue a new pipeline job
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const admin = session.role === "admin" || isAdmin(session.email);
  const body = await req.json() as { packageId?: string; skus?: string[] };

  if (!body.packageId) {
    return NextResponse.json({ error: "packageId required" }, { status: 400 });
  }

  const db = getDb();

  // Verify package exists and is ready
  const pkg = await db
    .select({ id: scanPackages.id, talentId: scanPackages.talentId, status: scanPackages.status })
    .from(scanPackages)
    .where(eq(scanPackages.id, body.packageId))
    .get();

  if (!pkg || pkg.status !== "ready") {
    return NextResponse.json({ error: "Package not found or not ready" }, { status: 404 });
  }

  // Auth: talent owns package, or admin
  if (pkg.talentId !== session.sub && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check pipeline access toggle (default = enabled if no row)
  const settings = await db
    .select({ pipelineEnabled: talentSettings.pipelineEnabled })
    .from(talentSettings)
    .where(eq(talentSettings.talentId, pkg.talentId))
    .get();
  if (settings && !settings.pipelineEnabled) {
    return NextResponse.json({ error: "Pipeline access is disabled for this talent" }, { status: 403 });
  }

  const skus = body.skus ?? ["preview", "realtime", "vfx"];
  const validSkus = ["preview", "realtime", "vfx", "training"];
  if (!skus.every((s) => validSkus.includes(s))) {
    return NextResponse.json({ error: "Invalid SKU" }, { status: 400 });
  }

  const jobId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(pipelineJobs).values({
    id: jobId,
    packageId: body.packageId,
    talentId: pkg.talentId,
    initiatedBy: session.sub,
    status: "queued",
    skus: JSON.stringify(skus),
    createdAt: now,
  });

  // Pre-create stage rows so the UI can display them immediately
  for (const stage of STAGE_NAMES) {
    await db.insert(pipelineStages).values({
      id: crypto.randomUUID(),
      jobId,
      stage,
      status: "pending",
    });
  }

  // Enqueue to Cloudflare Queue
  try {
    const { env } = getRequestContext();
    const queue = (env as unknown as Record<string, Queue>)["PIPELINE_QUEUE"];
    if (queue) {
      await queue.send({ jobId });
    }
  } catch {
    // Queue not available in local dev — job stays as "queued" in DB
  }

  return NextResponse.json({ jobId }, { status: 201 });
}
