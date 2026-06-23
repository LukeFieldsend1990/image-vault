import type { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { organisations, organisationMembers } from "@/lib/db/schema";

type Db = ReturnType<typeof drizzle>;

export interface AgencyMembership {
  organisationId: string;
  organisationName: string;
  shortCode: string | null;
  memberRole: "owner" | "admin" | "member";
}

/**
 * The agency org a user belongs to, if any. Agents are `rep`-role users who are
 * members of an `org_type = 'agency'` organisation. Returns the first agency
 * membership (a user is expected to belong to at most one agency).
 */
export async function getAgencyMembership(
  db: Db,
  userId: string,
): Promise<AgencyMembership | null> {
  if (!userId) return null;
  const row = await db
    .select({
      organisationId: organisations.id,
      organisationName: organisations.name,
      shortCode: organisations.shortCode,
      memberRole: organisationMembers.memberRole,
    })
    .from(organisationMembers)
    .innerJoin(organisations, eq(organisations.id, organisationMembers.organisationId))
    .where(and(eq(organisationMembers.userId, userId), eq(organisations.orgType, "agency")))
    .get();
  return (row as AgencyMembership | undefined) ?? null;
}

/** True if the user is an owner/admin of the given agency org. */
export async function isAgencyAdmin(db: Db, userId: string, orgId: string): Promise<boolean> {
  if (!userId || !orgId) return false;
  const row = await db
    .select({ memberRole: organisationMembers.memberRole })
    .from(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, orgId), eq(organisationMembers.userId, userId)))
    .get();
  return row?.memberRole === "owner" || row?.memberRole === "admin";
}
