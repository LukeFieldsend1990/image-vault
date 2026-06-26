import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, and, isNull, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers } from "@/lib/db/schema";
import { isIndustryRole } from "@/lib/auth/roles";
import { isAdmin } from "@/lib/auth/adminEmails";
import OrgOnboardingClient from "./org-onboarding-client";

/**
 * Post-2FA country picker for industry users whose org was auto-created during
 * signup (vendor invite flow) without a country. Finds the most recent org the
 * user owns/admins that's still missing a country and walks them through the
 * jurisdiction picker. If every org already has one, falls through to /dashboard.
 */
export default async function OrgOnboardingPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  if (!sessionCookie) redirect("/login");

  let userId = "";
  let role: string | null = null;
  let email = "";
  try {
    const payload = JSON.parse(atob(sessionCookie.split(".")[1])) as { sub?: string; role?: string; email?: string };
    userId = payload.sub ?? "";
    role = payload.role ?? null;
    email = payload.email ?? "";
  } catch {
    redirect("/login");
  }

  if (!userId) redirect("/login");
  if (!isIndustryRole(role) && !isAdmin(email)) redirect("/dashboard");

  const db = getDb();
  const pending = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      orgType: organisations.orgType,
    })
    .from(organisationMembers)
    .innerJoin(organisations, eq(organisations.id, organisationMembers.organisationId))
    .where(and(
      eq(organisationMembers.userId, userId),
      isNull(organisations.country),
    ))
    .orderBy(desc(organisationMembers.joinedAt))
    .all();

  if (pending.length === 0) redirect("/dashboard");

  const target = pending[0];
  return (
    <OrgOnboardingClient
      orgId={target.id}
      orgName={target.name}
      orgType={target.orgType}
      remaining={pending.length}
    />
  );
}
