export const runtime = "edge";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import PipelineJobClient from "./pipeline-job-client";

async function getSessionInfo(): Promise<{ sub: string; role: string } | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get("session")?.value;
  if (!session) return null;
  try {
    const payload = JSON.parse(atob(session.split(".")[1])) as { sub?: string; role?: string };
    if (!payload.sub) return null;
    return { sub: payload.sub, role: payload.role ?? "talent" };
  } catch {
    return null;
  }
}

export default async function PipelineJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const info = await getSessionInfo();
  if (!info) redirect("/login");

  const { jobId } = await params;

  return <PipelineJobClient jobId={jobId} sessionRole={info.role} />;
}
