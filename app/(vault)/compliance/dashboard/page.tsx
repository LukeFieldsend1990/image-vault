export const runtime = "edge";

import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/serverSession";
import ComplianceDashboardClient from "./dashboard-client";

export default async function ComplianceDashboardPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const role = session.role ?? null;

  // Only licensees and admins use this page; talent/rep use /compliance
  if (role !== "licensee" && role !== "admin") redirect("/compliance");

  return <ComplianceDashboardClient />;
}
