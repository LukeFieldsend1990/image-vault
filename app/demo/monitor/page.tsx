import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { siteSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import DemoMonitorClient from "./demo-monitor-client";

export const metadata = {
  title: "ImageVault — Deep Scan Tour",
};

export default async function DemoMonitorPage() {
  let enabled = false;
  try {
    const db = getDb();
    const row = await db
      .select({ value: siteSettings.value })
      .from(siteSettings)
      .where(eq(siteSettings.key, "demo_enabled"))
      .get();
    enabled = row?.value === "true";
  } catch {
    enabled = true;
  }

  if (!enabled) notFound();

  return <DemoMonitorClient />;
}
