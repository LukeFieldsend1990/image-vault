export const runtime = "edge";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import ComplianceDashboardClient from "./dashboard-client";

export default async function ComplianceDashboardPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  let role: string | null = null;
  let userId: string | null = null;

  if (sessionCookie) {
    try {
      const payload = JSON.parse(atob(sessionCookie.split(".")[1])) as {
        role?: string;
        sub?: string;
      };
      role = payload.role ?? null;
      userId = payload.sub ?? null;
    } catch {
      /* malformed JWT — redirect below */
    }
  }

  if (!userId) redirect("/login");

  // Only licensees and admins use this page; talent/rep use /compliance
  if (role !== "licensee" && role !== "admin") redirect("/compliance");

  return <ComplianceDashboardClient />;
}
