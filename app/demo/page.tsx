export const runtime = "edge";

import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import DemoClient from "./demo-client";

export const metadata = {
  title: "Image Vault — Product Tour",
};

export default async function DemoPage() {
  try {
    const db = getDb();
    const row = await db
      .select({ value: aiSettings.value })
      .from(aiSettings)
      .where(eq(aiSettings.key, "demo_enabled"))
      .get();
    if (!row || row.value !== "true") notFound();
  } catch {
    // In local dev without D1 bindings, allow the demo through
  }

  return <DemoClient />;
}
