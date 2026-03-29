export const runtime = "edge";

import { cookies } from "next/headers";
import TalentAuthoriseClient from "./talent-authorise-client";

function roleFromCookie(): string {
  try {
    const jar = cookies();
    const raw = jar.get("session")?.value;
    if (!raw) return "talent";
    const parts = raw.split(".");
    if (parts.length < 2) return "talent";
    const payload = JSON.parse(atob(parts[1])) as { role?: string };
    return payload.role ?? "talent";
  } catch {
    return "talent";
  }
}

export default async function TalentAuthorisePage({
  params,
  searchParams,
}: {
  params: Promise<{ licenceId: string }>;
  searchParams: Promise<{ confirm_preauth?: string }>;
}) {
  const { licenceId } = await params;
  const sp = await searchParams;
  const role = roleFromCookie();
  const confirmPreauth = sp.confirm_preauth === "1";

  return (
    <TalentAuthoriseClient
      licenceId={licenceId}
      role={role}
      confirmPreauth={confirmPreauth}
    />
  );
}
