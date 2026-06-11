export const runtime = "edge";

import { getServerSession } from "@/lib/auth/serverSession";
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
    const session = await getServerSession();
    if (!session || session.role !== "talent") return null;

    const db = getDb();
    const row = await db
      .select({
        fullName: talentProfiles.fullName,
        profileImageUrl: talentProfiles.profileImageUrl,
        knownFor: talentProfiles.knownFor,
      })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, session.sub))
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
