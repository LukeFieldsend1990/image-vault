export const runtime = "edge";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { bridgeTokens, bridgeDevices, bridgeGrants, licences } from "@/lib/db/schema";
import { eq, isNull, and, gt } from "drizzle-orm";
import BridgeSettingsClient from "./bridge-client";

async function getSessionData() {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return null;
    const payload = JSON.parse(atob(session.split(".")[1])) as {
      sub?: string;
      role?: string;
    };
    return { userId: payload.sub ?? "", role: payload.role ?? "talent" };
  } catch {
    return null;
  }
}

export default async function BridgeSettingsPage() {
  const user = await getSessionData();
  if (!user) redirect("/login");

  // Talent and rep get read-only visibility; licensee gets full management
  const canManage = user.role === "licensee" || user.role === "admin";

  const db = getDb();

  // Fetch this user's bridge tokens
  const tokens = await db
    .select({
      id: bridgeTokens.id,
      displayName: bridgeTokens.displayName,
      lastUsedAt: bridgeTokens.lastUsedAt,
      createdAt: bridgeTokens.createdAt,
      revokedAt: bridgeTokens.revokedAt,
    })
    .from(bridgeTokens)
    .where(eq(bridgeTokens.userId, user.userId))
    .all();

  // Fetch this user's bridge devices
  const devices = await db
    .select({
      id: bridgeDevices.id,
      fingerprint: bridgeDevices.fingerprint,
      displayName: bridgeDevices.displayName,
      lastSeenAt: bridgeDevices.lastSeenAt,
      createdAt: bridgeDevices.createdAt,
    })
    .from(bridgeDevices)
    .where(eq(bridgeDevices.userId, user.userId))
    .all();

  // One "session" = one live (licenceId, deviceId). Each DCC open inserts a new grant,
  // so without dedup a single bridge reopening a package N times counts as N sessions.
  let activeGrantsByLicence: { licenceId: string; count: number }[] = [];
  if (user.role === "talent" || user.role === "rep") {
    const userLicences = await db
      .select({ id: licences.id })
      .from(licences)
      .where(eq(licences.talentId, user.userId))
      .all();

    if (userLicences.length > 0) {
      const licenceIds = new Set(userLicences.map((l) => l.id));
      // Server component — runs once per request, not per render.
      // eslint-disable-next-line react-hooks/purity
      const now = Math.floor(Date.now() / 1000);
      const grants = await db
        .select({
          licenceId: bridgeGrants.licenceId,
          deviceId: bridgeGrants.deviceId,
        })
        .from(bridgeGrants)
        .where(
          and(isNull(bridgeGrants.revokedAt), gt(bridgeGrants.expiresAt, now))
        )
        .all();

      const seen = new Set<string>();
      const countMap = new Map<string, number>();
      for (const g of grants) {
        if (!licenceIds.has(g.licenceId)) continue;
        const key = `${g.licenceId}:${g.deviceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        countMap.set(g.licenceId, (countMap.get(g.licenceId) ?? 0) + 1);
      }
      activeGrantsByLicence = Array.from(countMap.entries()).map(
        ([licenceId, count]) => ({ licenceId, count })
      );
    }
  }

  return (
    <BridgeSettingsClient
      role={user.role}
      canManage={canManage}
      initialTokens={tokens}
      initialDevices={devices}
      activeGrantsByLicence={activeGrantsByLicence}
    />
  );
}
