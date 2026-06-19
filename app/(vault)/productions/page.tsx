import { cookies } from "next/headers";
import { isComplianceRole } from "@/lib/auth/roles";
import ProductionsClient from "./productions-client";
import OversightProductionsClient from "./oversight-productions-client";

export default async function ProductionsPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  let role: string | null = null;
  if (sessionCookie) {
    try {
      const payload = JSON.parse(atob(sessionCookie.split(".")[1])) as { role?: string };
      role = payload.role ?? null;
    } catch { /* malformed JWT — fall through to default view */ }
  }

  // Compliance watchers (union/regulator/insurer) get the read-only oversight
  // tracker. Everyone else keeps the production-management view.
  if (isComplianceRole(role)) return <OversightProductionsClient />;

  return <ProductionsClient />;
}
