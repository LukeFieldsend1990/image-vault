export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pipelineOutputs, pipelineJobs } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";
import { AwsClient } from "aws4fetch";
import { getRequestContext } from "@cloudflare/next-on-pages";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];
const DOWNLOAD_TTL = 3600; // 1 hour presigned URL

function cfEnv(key: string): string | undefined {
  try {
    return (getRequestContext().env as unknown as Record<string, string | undefined>)[key];
  } catch {
    return process.env[key];
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();
  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);

  const output = await db
    .select()
    .from(pipelineOutputs)
    .where(eq(pipelineOutputs.id, id))
    .get();

  if (!output) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Verify job ownership
  const job = await db
    .select({ talentId: pipelineJobs.talentId })
    .from(pipelineJobs)
    .where(eq(pipelineJobs.id, output.jobId))
    .get();

  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job.talentId !== session.sub && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const accountId = cfEnv("CF_ACCOUNT_ID")!;
  const pipelineBucketName = "image-vault-pipeline";

  const r2 = new AwsClient({
    accessKeyId: cfEnv("R2_ACCESS_KEY_ID")!,
    secretAccessKey: cfEnv("R2_SECRET_ACCESS_KEY")!,
    region: "auto",
    service: "s3",
  });

  const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${pipelineBucketName}/${output.r2Key}`);
  url.searchParams.set("X-Amz-Expires", String(DOWNLOAD_TTL));
  url.searchParams.set("response-content-disposition", `attachment; filename="${output.filename}"`);

  const signed = await r2.sign(
    new Request(url.toString(), { method: "GET" }),
    { aws: { signQuery: true } },
  );

  return NextResponse.redirect(signed.url, { status: 302 });
}
