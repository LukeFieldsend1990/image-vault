import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { talentProfiles, organisationMembers, productions } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
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

  const db = getDb();

  // Industry/production-company users: if they already have a production (e.g.
  // an admin pre-built one and invited them, or they were added to an org with
  // one), land them on it; otherwise start the guided setup wizard.
  if (isIndustryRole(session.role)) {
    const orgIds = (await db
      .select({ organisationId: organisationMembers.organisationId })
      .from(organisationMembers)
      .where(eq(organisationMembers.userId, session.userId))
      .all()).map((m) => m.organisationId);
    let hasProduction = false;
    if (orgIds.length > 0) {
      const prod = await db
        .select({ id: productions.id })
        .from(productions)
        .where(inArray(productions.organisationId, orgIds))
        .get();
      hasProduction = !!prod;
    }
    redirect(hasProduction ? "/productions" : "/productions/setup");
  }

  // Only talent sees this onboarding — reps go straight to dashboard.
  if (session.role !== "talent") redirect("/dashboard");

  // Already onboarded — skip unless ?update=1 is set (e.g. from settings page)
  const existing = await db
    .select({ userId: talentProfiles.userId })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, session.userId))
    .get();

  if (existing && !update) redirect("/dashboard");

  return <OnboardingClient isUpdate={!!existing} />;
}
