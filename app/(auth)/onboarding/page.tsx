export const runtime = "edge";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { talentProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getServerSession } from "@/lib/auth/serverSession";
import OnboardingClient from "./onboarding-client";

async function getSessionInfo(): Promise<{ userId: string; role: string } | null> {
  const session = await getServerSession();
  if (!session) return null;
  return { userId: session.sub, role: session.role ?? "" };
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ update?: string }>;
}) {
  const { update } = await searchParams;
  const session = await getSessionInfo();

  if (!session?.userId) redirect("/login");

  // Only talent sees onboarding — reps and licensees go straight to dashboard
  if (session.role !== "talent") redirect("/dashboard");

  // Already onboarded — skip unless ?update=1 is set (e.g. from settings page)
  const db = getDb();
  const existing = await db
    .select({ userId: talentProfiles.userId })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, session.userId))
    .get();

  if (existing && !update) redirect("/dashboard");

  return <OnboardingClient isUpdate={!!existing} />;
}
