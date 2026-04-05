import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_EMAILS } from "@/lib/auth/adminEmails";

export async function requireAdmin(): Promise<{ userId: string; email: string }> {
  const cookieStore = await cookies();
  const session = cookieStore.get("session")?.value;
  if (!session) redirect("/login?next=/admin");

  try {
    const payload = JSON.parse(atob(session.split(".")[1])) as {
      sub?: string;
      email?: string;
    };
    const email = payload.email ?? "";
    if (!ADMIN_EMAILS.includes(email)) redirect("/dashboard");
    return { userId: payload.sub ?? "", email };
  } catch {
    redirect("/login?next=/admin");
  }
}
