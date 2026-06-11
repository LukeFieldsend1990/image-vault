export const runtime = "edge";

import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getServerSession } from "@/lib/auth/serverSession";
import PipelineJobClient from "./pipeline-job-client";

async function getSessionInfo(): Promise<{ sub: string; role: string } | null> {
  const session = await getServerSession();
  if (!session) return null;
  const role = isAdmin(session.email) ? "admin" : (session.role ?? "talent");
  return { sub: session.sub, role };
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
