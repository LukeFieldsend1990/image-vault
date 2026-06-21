import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isIndustryRole } from "@/lib/auth/roles";
import { isAdmin } from "@/lib/auth/adminEmails";
import SetupClient from "./setup-client";

// Guided onboarding wizard for industry / production-company users. Lives under
// the /productions prefix (industry's allowed home) rather than /onboarding,
// which is talent-only. Re-entrant: reachable any time from the dashboard
// "finish setup" checklist, not just immediately after 2FA.
export default async function ProductionSetupPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  if (!sessionCookie) redirect("/login");

  let role: string | null = null;
  let email = "";
  try {
    const payload = JSON.parse(atob(sessionCookie.split(".")[1])) as { role?: string; email?: string };
    role = payload.role ?? null;
    email = payload.email ?? "";
  } catch {
    redirect("/login");
  }

  // Industry/admin only — other roles have their own homes.
  if (!isIndustryRole(role) && !isAdmin(email)) redirect("/dashboard");

  return <SetupClient />;
}
