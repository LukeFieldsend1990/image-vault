import { cookies } from "next/headers";
import RequestsClient from "./requests-client";
import RepReservedRoles from "@/app/(vault)/roster/rep-reserved-roles";

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
  const isRep = role === "rep";
  return (
    <>
      {/* Path C: reserved roles a production assigned to this agent, awaiting the
          rep to connect their client's email. Shown alongside incoming requests
          (not just on /roster) so reps see the production detail and consent
          terms here too. */}
      {isRep && <RepReservedRoles className="px-4 sm:px-8 pt-4 sm:pt-8" />}
      <RequestsClient isRep={isRep} />
    </>
  );
}
