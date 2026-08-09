import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import TraceClient from "./trace-client";

export const metadata = {
  title: "Trace a file — ImageVault",
};

// Talent, reps and admins can trace scans they are entitled to see. Licensees
// hold files; whose a given hash belongs to is not theirs to ask. The API
// re-checks entitlement per match — this is only the front door.
export default async function TracePage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  let role: string | null = null;
  if (sessionCookie) {
    try {
      const payload = JSON.parse(atob(sessionCookie.split(".")[1])) as { role?: string };
      role = payload.role ?? null;
    } catch {
      /* malformed JWT — redirect below */
    }
  }

  if (!role) redirect("/login?next=/trace");
  if (role === "licensee" || role === "industry") redirect("/productions");

  return <TraceClient />;
}
