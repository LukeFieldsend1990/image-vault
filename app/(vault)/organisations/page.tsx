import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isIndustryRole } from "@/lib/auth/roles";
import { isAdmin } from "@/lib/auth/adminEmails";
import OrganisationsClient from "./organisations-client";

export default async function OrganisationsPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  let role: string | null = null;
  let email = "";
  if (sessionCookie) {
    try {
      const payload = JSON.parse(atob(sessionCookie.split(".")[1])) as { role?: string; email?: string };
      role = payload.role ?? null;
      email = payload.email ?? "";
    } catch { /* malformed JWT — fall through to redirect */ }
  }

  // Organisations are an industry-role surface (admins always allowed).
  if (!isIndustryRole(role) && !isAdmin(email)) redirect("/dashboard");

  return <OrganisationsClient />;
}
