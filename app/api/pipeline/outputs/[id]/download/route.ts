export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pipelineOutputs, pipelineJobs } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";

// GET /api/pipeline/outputs/:id/download — stream ZIP bundle from PIPELINE_BUCKET
// Uses the Worker binding directly (no R2 API keys required — binding is already authed)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();
  const admin = session.role === "admin" || isAdmin(session.email);

  const output = await db
    .select()
    .from(pipelineOutputs)
    .where(eq(pipelineOutputs.id, id))
    .get();

  if (!output) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const job = await db
    .select({ talentId: pipelineJobs.talentId })
    .from(pipelineJobs)
    .where(eq(pipelineJobs.id, output.jobId))
    .get();

  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job.talentId !== session.sub && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { env } = getRequestContext();
  const bucket = (env as unknown as { PIPELINE_BUCKET: R2Bucket }).PIPELINE_BUCKET;

  const obj = await bucket.get(output.r2Key);
  if (!obj) return NextResponse.json({ error: "File not found in storage" }, { status: 404 });

  const filename = encodeURIComponent(output.filename);

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(output.sizeBytes),
      "Content-Disposition": `attachment; filename="${output.filename}"; filename*=UTF-8''${filename}`,
      "Cache-Control": "private, no-store",
    },
  });
}
