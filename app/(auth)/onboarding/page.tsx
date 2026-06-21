import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { talentProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isIndustryRole } from "@/lib/auth/roles";
import OnboardingClient from "./onboarding-client";

async function getSessionInfo(): Promise<{ userId: string; role: string } | null> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return null;
    const payload = JSON.parse(atob(session.split(".")[1])) as {
      sub?: string;
      role?: string;
    };
    return { userId: payload.sub ?? "", role: payload.role ?? "" };
  } catch {
    return null;
  }
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ update?: string }>;
}) {
  const { update } = await searchParams;
  const session = await getSessionInfo();

  if (!session?.userId) redirect("/login");

  // Industry/production-company users get the guided production setup wizard,
  // which lives under /productions (their home), not the talent onboarding flow.
  if (isIndustryRole(session.role)) redirect("/productions/setup");

  // Only talent sees this onboarding — reps go straight to dashboard.
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
