import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { siteSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import DemoClient from "./demo-client";

export const metadata = {
  title: "ImageVault — Product Tour",
};

export default async function DemoPage() {
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
    // In local dev without D1 bindings, allow the demo through
    enabled = true;
  }

  if (!enabled) notFound();

  return <DemoClient />;
}
