import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { talentProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import AccountsClient from "./accounts-client";

async function getTalentName(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return null;
    const payload = JSON.parse(atob(session.split(".")[1])) as { sub?: string; role?: string };
    if (!payload.sub || payload.role !== "talent") return null;

    const db = getDb();
    const row = await db
      .select({ fullName: talentProfiles.fullName })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, payload.sub))
      .get();
    return row?.fullName ?? "your likeness";
  } catch {
    return null;
  }
}

export default async function MonitorAccountsPage() {
  const name = await getTalentName();
  if (!name) redirect("/vault/monitor");
  return <AccountsClient talentName={name} />;
}
