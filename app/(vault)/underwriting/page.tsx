export const runtime = "edge";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isComplianceRole } from "@/lib/auth/roles";
import UnderwritingClient from "./underwriting-client";

// Insurer underwriting surface (§4.2 / §4.4). Open to compliance watchers (the
// insurer subtype lands here) and admins; the API enforces per-production insurer
// grants, so a union/regulator watcher with no insurer grant simply sees an empty
// portfolio.
export default async function UnderwritingPage() {
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
      role = payload.role ?? null;
      userId = payload.sub ?? null;
      email = payload.email ?? null;
    } catch { /* malformed JWT — redirect below */ }
  }

  if (!userId) redirect("/login");
  if (!isComplianceRole(role) && !isAdmin(email ?? "")) redirect("/dashboard");

  return <UnderwritingClient />;
}
