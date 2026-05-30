export const runtime = "edge";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import RoyaltiesClient from "./royalties-client";

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

export default async function RoyaltiesPage() {
  const role = await getRole();
  // Licensees don't earn royalties; send them home.
  if (role === "licensee") redirect("/dashboard");
  return <RoyaltiesClient />;
}
