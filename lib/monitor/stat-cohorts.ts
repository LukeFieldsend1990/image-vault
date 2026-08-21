/**
 * Cohort resolvers for the deepfake statistics surfaces.
 *
 * `lib/monitor/hit-stats.ts` counts hits for whatever set of talent it is
 * handed; this module is the one place that decides what that set *is* for
 * each viewer. Keeping the two apart is deliberate — the counting layer can
 * then never widen a scope, and every authorisation question lives here where
 * it can be read in one sitting:
 *
 *   • union   → talent affiliated with the union (roster match or self-declared)
 *   • rep     → the rep's managed roster
 *   • admin   → every talent profile on the platform, or one union's slice
 *
 * Names come back with the cohort because the reports render a per-member
 * breakdown and the counting layer has no business joining profiles.
 */

import { eq, inArray } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { talentProfiles, talentReps } from "@/lib/db/schema";
import { affiliatedTalent } from "@/lib/compliance/affiliation";
import type { CohortMember } from "./hit-stats";

type Db = ReturnType<typeof getDb>;

const CHUNK = 80;

/** Talent affiliated with a union — the union watcher's cohort. */
export async function unionCohort(db: Db, unionId: string): Promise<CohortMember[]> {
  const talent = await affiliatedTalent(db, [unionId]);
  return talent.map((t) => ({ talentId: t.talentId, name: t.name }));
}

/** The talent a rep manages — the rep's cohort. */
export async function repRosterCohort(db: Db, repId: string): Promise<CohortMember[]> {
  const rows = await db
    .select({ talentId: talentReps.talentId })
    .from(talentReps)
    .where(eq(talentReps.repId, repId))
    .all();
  const ids = rows.map((r) => r.talentId);
  if (ids.length === 0) return [];

  const named = new Map<string, string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const profiles = await db
      .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
      .from(talentProfiles)
      .where(inArray(talentProfiles.userId, ids.slice(i, i + CHUNK)))
      .all();
    for (const p of profiles) named.set(p.userId, p.fullName);
  }

  // Roster rows without a profile still count — a talent mid-onboarding is on
  // the roster and dropping them would quietly shrink the denominator.
  return ids.map((talentId) => ({ talentId, name: named.get(talentId) ?? "Unknown talent" }));
}

/** Every talent on the platform — the admin's cohort. */
export async function platformCohort(db: Db): Promise<CohortMember[]> {
  const rows = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .all();
  return rows.map((r) => ({ talentId: r.userId, name: r.fullName }));
}
