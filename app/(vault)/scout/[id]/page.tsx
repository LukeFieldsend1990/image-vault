import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isScoutRole } from "@/lib/auth/roles";
import TrialClient from "./trial-client";

export const dynamic = "force-dynamic";

// Admin is the email whitelist, not a role — an admin's underlying account is
// often a talent account, so the gate must check both.
function getSession(): Promise<{ role: string; email: string }> {
  return cookies().then((store) => {
    try {
      const session = store.get("session")?.value;
      if (!session) return { role: "talent", email: "" };
      const payload = JSON.parse(atob(session.split(".")[1])) as { role?: string; email?: string };
      return { role: payload.role ?? "talent", email: payload.email ?? "" };
    } catch {
      return { role: "talent", email: "" };
    }
  });
}

export default async function TrialPage({ params }: { params: Promise<{ id: string }> }) {
  const { role, email } = await getSession();
  if (!isScoutRole(role) && !isAdmin(email)) redirect("/dashboard");
  const { id } = await params;
  return <TrialClient trialId={id} />;
}
