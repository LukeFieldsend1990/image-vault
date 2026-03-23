export const runtime = "edge";

import { cookies } from "next/headers";
import RequestsClient from "./requests-client";

async function getRole(): Promise<string | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get("session")?.value;
  if (!session) return null;
  try {
    return (JSON.parse(atob(session.split(".")[1])) as { role?: string }).role ?? null;
  } catch { return null; }
}

export default async function RequestsPage() {
  const role = await getRole();
  return <RequestsClient isRep={role === "rep"} />;
}
