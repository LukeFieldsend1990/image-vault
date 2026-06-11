export const runtime = "edge";

import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/serverSession";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/dashboard");
  if (session.role === "rep") redirect("/roster");
  return <DashboardClient />;
}
