export const runtime = "edge";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardClient from "./dashboard-client";

async function getRole(): Promise<string | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get("session")?.value;
  if (!session) return null;
  try {
    const payload = JSON.parse(atob(session.split(".")[1])) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const role = await getRole();
  if (role === "rep") redirect("/roster");
  return <DashboardClient />;
}
