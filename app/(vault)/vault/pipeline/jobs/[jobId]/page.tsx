export const runtime = "edge";

import { requireSession } from "@/lib/auth/requireSession";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import PipelineJobClient from "./pipeline-job-client";

async function getSessionSub(): Promise<string | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get("session")?.value;
  if (!session) return null;
  try {
    const payload = JSON.parse(atob(session.split(".")[1])) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export default async function PipelineJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const sub = await getSessionSub();
  if (!sub) redirect("/login");

  const { jobId } = await params;

  return <PipelineJobClient jobId={jobId} />;
}
