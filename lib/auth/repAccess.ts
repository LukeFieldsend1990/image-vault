import { getDb } from "@/lib/db";
import { talentReps } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

/** Returns true if repId is delegated to manage talentId's vault. */
export async function hasRepAccess(repId: string, talentId: string): Promise<boolean> {
  const db = getDb();
  const row = await db
    .select({ id: talentReps.id })
    .from(talentReps)
    .where(and(eq(talentReps.repId, repId), eq(talentReps.talentId, talentId)))
    .get();
  return row != null;
}
