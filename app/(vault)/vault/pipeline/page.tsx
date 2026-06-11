export const runtime = "edge";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { scanPackages, talentSettings } from "@/lib/db/schema";
import { eq, and, sql, isNull, desc } from "drizzle-orm";
import { pipelineJobs } from "@/lib/db/schema";
import { getServerSession } from "@/lib/auth/serverSession";
import PipelineSelectClient from "./pipeline-select-client";

async function getSession(): Promise<{ userId: string; role: string } | null> {
  const session = await getServerSession();
  if (!session) return null;
  return { userId: session.sub, role: session.role ?? "" };
}

export default async function PipelinePage() {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const db = getDb();

  // Guard: only accessible when pipelineEnabled
  const settings = await db
    .select({ pipelineEnabled: talentSettings.pipelineEnabled })
    .from(talentSettings)
    .where(eq(talentSettings.talentId, session.userId))
    .get();

  if (settings && !settings.pipelineEnabled) redirect("/dashboard");

  // Fetch ready packages for this talent
  const packages = await db
    .select({
      id: scanPackages.id,
      name: scanPackages.name,
      captureDate: scanPackages.captureDate,
      studioName: scanPackages.studioName,
      totalSizeBytes: scanPackages.totalSizeBytes,
      fileCount: sql<number>`(select count(*) from scan_files where package_id = ${scanPackages.id})`,
    })
    .from(scanPackages)
    .where(and(
      eq(scanPackages.talentId, session.userId),
      eq(scanPackages.status, "ready"),
      isNull(scanPackages.deletedAt),
    ))
    .all();

  // Fetch all pipeline jobs for this talent with package names
  const jobs = await db
    .select({
      id: pipelineJobs.id,
      packageName: scanPackages.name,
      status: pipelineJobs.status,
      createdAt: pipelineJobs.createdAt,
      completedAt: pipelineJobs.completedAt,
    })
    .from(pipelineJobs)
    .leftJoin(scanPackages, eq(pipelineJobs.packageId, scanPackages.id))
    .where(eq(pipelineJobs.talentId, session.userId))
    .orderBy(desc(pipelineJobs.createdAt))
    .limit(20)
    .all();

  const recentJobs = jobs.map((j) => ({
    id: j.id,
    packageName: j.packageName ?? "Unknown package",
    status: j.status,
    createdAt: j.createdAt,
    completedAt: j.completedAt ?? null,
  }));

  return <PipelineSelectClient packages={packages} recentJobs={recentJobs} />;
}
