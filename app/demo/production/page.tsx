import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { siteSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import DemoProductionClient from "./demo-production-client";

export const metadata = {
  title: "Image Vault — Production & Compliance Tour",
};

export default async function DemoProductionPage() {
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

  return <DemoProductionClient />;
}
