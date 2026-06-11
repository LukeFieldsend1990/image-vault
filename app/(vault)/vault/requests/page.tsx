export const runtime = "edge";

import { getServerSession } from "@/lib/auth/serverSession";
import RequestsClient from "./requests-client";

async function getRole(): Promise<string | null> {
  const session = await getServerSession();
  return session?.role ?? null;
}

export default async function RequestsPage() {
  const role = await getRole();
  return <RequestsClient isRep={role === "rep"} />;
}
