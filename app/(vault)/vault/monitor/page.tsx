export const runtime = "edge";

import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { talentProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import MonitorClient from "./monitor-client";

interface KnownForEntry {
  title: string;
  year?: number;
  type: "movie" | "tv";
}

export interface TalentIdentityForMonitor {
  fullName: string;
  profileImageUrl: string | null;
  knownFor: KnownForEntry[];
}

async function getTalentIdentity(): Promise<TalentIdentityForMonitor | null> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return null;
    const payload = JSON.parse(atob(session.split(".")[1])) as { sub?: string; role?: string };
    if (!payload.sub || payload.role !== "talent") return null;

    const db = getDb();
    const row = await db
      .select({
        fullName: talentProfiles.fullName,
        profileImageUrl: talentProfiles.profileImageUrl,
        knownFor: talentProfiles.knownFor,
      })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, payload.sub))
      .get();

    if (!row) return null;
    return {
      fullName: row.fullName,
      profileImageUrl: row.profileImageUrl ?? null,
      knownFor: JSON.parse(row.knownFor ?? "[]") as KnownForEntry[],
    };
  } catch {
    return null;
  }
}

export default async function MonitorPage() {
  const identity = await getTalentIdentity();
  return <MonitorClient identity={identity} />;
}
