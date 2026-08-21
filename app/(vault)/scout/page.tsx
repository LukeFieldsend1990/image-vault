import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isScoutRole } from "@/lib/auth/roles";
import ScoutClient from "./scout-client";

export const dynamic = "force-dynamic";

function getRole(): Promise<string> {
  return cookies().then((store) => {
    try {
      const session = store.get("session")?.value;
      if (!session) return "talent";
      const payload = JSON.parse(atob(session.split(".")[1])) as { role?: string };
      return payload.role ?? "talent";
    } catch {
      return "talent";
    }
  });
}

export default async function ScoutPage() {
  const role = await getRole();
  if (!isScoutRole(role)) redirect("/dashboard");
  return <ScoutClient />;
}
