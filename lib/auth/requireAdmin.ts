import { redirect } from "next/navigation";
import { ADMIN_EMAILS } from "@/lib/auth/adminEmails";
import { getServerSession } from "@/lib/auth/serverSession";

export async function requireAdmin(): Promise<{ userId: string; email: string }> {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/admin");
  if (!ADMIN_EMAILS.includes(session.email)) redirect("/dashboard");
  return { userId: session.sub, email: session.email };
}
