export const runtime = "edge";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { talentSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import DashboardClient from "./dashboard-client";

async function getSession(): Promise<{ role: string; userId: string } | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get("session")?.value;
  if (!session) return null;
  try {
    const payload = JSON.parse(atob(session.split(".")[1])) as { role?: string; sub?: string };
    return { role: payload.role ?? "", userId: payload.sub ?? "" };
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const session = await getSession();
  if (session?.role === "rep") redirect("/roster");

  let pipelineEnabled = true;
  if (session?.userId) {
    try {
      const db = getDb();
      const row = await db
        .select({ pipelineEnabled: talentSettings.pipelineEnabled })
        .from(talentSettings)
        .where(eq(talentSettings.talentId, session.userId))
        .get();
      if (row) pipelineEnabled = row.pipelineEnabled;
    } catch {
      // non-fatal — default to true
    }
  }

  return <DashboardClient pipelineEnabled={pipelineEnabled} />;
}
