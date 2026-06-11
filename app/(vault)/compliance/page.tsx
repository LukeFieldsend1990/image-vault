export const runtime = "edge";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getServerSession } from "@/lib/auth/serverSession";
import ComplianceClient from "./compliance-client";
import RepComplianceOverview from "./rep-compliance-overview";

export default async function CompliancePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const role = session.role ?? null;
  const userId = session.sub;
  const email = session.email ?? null;

  // Licensees access compliance through their licence panel, not this page
  if (role === "licensee") redirect("/dashboard");

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
