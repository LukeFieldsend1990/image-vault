export const runtime = "edge";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ComplianceClient from "./compliance-client";

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

export default async function CompliancePage() {
  const role = await getRole();
  // Consent is a talent/rep act; licensees use their licence's compliance panel instead.
  if (role === "licensee") redirect("/dashboard");
  return <ComplianceClient />;
}
