export const runtime = "edge";

import { getServerSession } from "@/lib/auth/serverSession";
import TalentLicencesClient from "./talent-licences-client";

async function getRole(): Promise<string | null> {
  const session = await getServerSession();
  return session?.role ?? null;
}

export default async function TalentLicencesPage({
  searchParams,
}: {
  searchParams: Promise<{ highlight?: string }>;
}) {
  const [role, { highlight }] = await Promise.all([getRole(), searchParams]);
  return <TalentLicencesClient role={role ?? "talent"} highlight={highlight ?? null} />;
}
