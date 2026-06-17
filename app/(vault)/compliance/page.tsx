export const runtime = "edge";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole, isComplianceRole } from "@/lib/auth/roles";
import { cookies } from "next/headers";
import ComplianceClient from "./compliance-client";
import RepComplianceOverview from "./rep-compliance-overview";

export default async function CompliancePage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  let role: string | null = null;
  let userId: string | null = null;
  let email: string | null = null;

  if (sessionCookie) {
    try {
      const payload = JSON.parse(atob(sessionCookie.split(".")[1])) as {
        role?: string;
        sub?: string;
        email?: string;
      };
      role  = payload.role ?? null;
      userId = payload.sub ?? null;
      email  = payload.email ?? null;
    } catch { /* malformed JWT — will redirect below */ }
  }

  if (!userId) redirect("/login");

  // Compliance watchers only see their own read-only evidence area.
  if (isComplianceRole(role)) redirect("/evidence");

  // Licensees access compliance through their licence panel, not this page
  if (isIndustryRole(role)) redirect("/dashboard");

  // Reps always have access (they view their talent's compliance, not their own flag)
  // Admins always have access; for talent check the per-user DB flag
  if (role !== "rep" && !isAdmin(email ?? "")) {
    const db = getDb();
    const row = await db
      .select({ complianceEnabled: users.complianceEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (row?.complianceEnabled === false) redirect("/dashboard");
  }

  // Reps see an aggregated overview of all managed talent — each card links to the talent's roster detail
  if (role === "rep") {
    return <RepComplianceOverview />;
  }

  return <ComplianceClient />;
}
