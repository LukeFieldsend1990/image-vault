import type { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { talentReps, licences } from "@/lib/db/schema";

type Db = ReturnType<typeof drizzle>;

export interface RepAgencyContext {
  // Agency org IDs the rep is attached to via talent_reps.agencyOrgId.
  agencyOrgIds: string[];
  // Talent directly managed by this rep.
  ownTalentIds: string[];
  // Talent managed by ANY rep sharing an agency with this rep (includes own).
  agencyTalentIds: string[];
  // Productions where some agency-managed talent holds an APPROVED licence.
  // Used to grant agency-shared production/licence visibility — rosters stay
  // segregated; only production-scoped data crosses the agency boundary.
  agencyProductionIds: string[];
}

const EMPTY: RepAgencyContext = {
  agencyOrgIds: [],
  ownTalentIds: [],
  agencyTalentIds: [],
  agencyProductionIds: [],
};

export async function getRepAgencyContext(db: Db, repId: string): Promise<RepAgencyContext> {
  if (!repId) return EMPTY;

  const ownRows = await db
    .select({ talentId: talentReps.talentId, agencyOrgId: talentReps.agencyOrgId })
    .from(talentReps)
    .where(eq(talentReps.repId, repId))
    .all();

  const ownTalentIds = [...new Set(ownRows.map((r) => r.talentId))];
  const agencyOrgIds = [...new Set(ownRows.map((r) => r.agencyOrgId).filter((v): v is string => !!v))];

  let agencyTalentIds = ownTalentIds;
  if (agencyOrgIds.length > 0) {
    const colleagueRows = await db
      .select({ talentId: talentReps.talentId })
      .from(talentReps)
      .where(and(inArray(talentReps.agencyOrgId, agencyOrgIds), isNotNull(talentReps.agencyOrgId)))
      .all();
    agencyTalentIds = [...new Set([...ownTalentIds, ...colleagueRows.map((r) => r.talentId)])];
  }

  let agencyProductionIds: string[] = [];
  if (agencyTalentIds.length > 0) {
    const licenceRows = await db
      .select({ productionId: licences.productionId })
      .from(licences)
      .where(and(
        inArray(licences.talentId, agencyTalentIds),
        eq(licences.status, "APPROVED"),
        isNotNull(licences.productionId),
      ))
      .all();
    agencyProductionIds = [...new Set(licenceRows.map((r) => r.productionId).filter((v): v is string => !!v))];
  }

  return { agencyOrgIds, ownTalentIds, agencyTalentIds, agencyProductionIds };
}
