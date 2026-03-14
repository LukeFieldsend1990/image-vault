export const runtime = "edge";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { scanPackages, talentSettings } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import PipelineSelectClient from "./pipeline-select-client";

async function getSession(): Promise<{ userId: string; role: string } | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get("session")?.value;
  if (!session) return null;
  try {
    const p = JSON.parse(atob(session.split(".")[1])) as { sub?: string; role?: string };
    return { userId: p.sub ?? "", role: p.role ?? "" };
  } catch { return null; }
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
    ))
    .all();

  return <PipelineSelectClient packages={packages} />;
}
