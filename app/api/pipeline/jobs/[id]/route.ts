export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pipelineJobs, pipelineStages, pipelineOutputs, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

// GET /api/pipeline/jobs/[id] — job detail with stages + outputs
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();
  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);

  const job = await db
    .select()
    .from(pipelineJobs)
    .where(eq(pipelineJobs.id, id))
    .get();

  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job.talentId !== session.sub && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [stages, outputs, pkg] = await Promise.all([
    db.select().from(pipelineStages).where(eq(pipelineStages.jobId, id)).all(),
    db.select().from(pipelineOutputs).where(eq(pipelineOutputs.jobId, id)).all(),
    db.select({ name: scanPackages.name, id: scanPackages.id })
      .from(scanPackages).where(eq(scanPackages.id, job.packageId)).get(),
  ]);

  return NextResponse.json({ job, stages, outputs, package: pkg });
}

// DELETE /api/pipeline/jobs/[id] — cancel a queued job
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();
  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);

  const job = await db
    .select({ id: pipelineJobs.id, talentId: pipelineJobs.talentId, status: pipelineJobs.status })
    .from(pipelineJobs)
    .where(eq(pipelineJobs.id, id))
    .get();

  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job.talentId !== session.sub && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (job.status !== "queued") {
    return NextResponse.json({ error: "Can only cancel queued jobs" }, { status: 400 });
  }

  await db.update(pipelineJobs)
    .set({ status: "cancelled", completedAt: Math.floor(Date.now() / 1000) })
    .where(eq(pipelineJobs.id, id));

  return NextResponse.json({ ok: true });
}
