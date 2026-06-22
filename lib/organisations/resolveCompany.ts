import { organisations, productionCompanies } from "@/lib/db/schema";
import { mintOrgCode } from "@/lib/codes/codes";
import { eq, and, sql, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type { OrgType } from "./orgTypes";

// Accepts both the schema-typed db from getDb() and the generically-typed db
// carried by skill/MCP contexts — only plain select/insert/update are used.
type Db = ReturnType<typeof drizzle>;

export interface CompanyOrgRefs {
  /** The canonical organisation for this production company. */
  organisationId: string;
  /** The backward-compatible production_companies shim, linked 1:1 to the org. */
  productionCompanyId: string;
}

/**
 * Resolve a production-company name to the unified organisation entity.
 *
 * Organisations are the single source of truth for production companies; the
 * `production_companies` table is kept as a 1:1 shim (linked via
 * `organisations.production_company_id`) so that legacy `productions.company_id`
 * attribution keeps working. This helper guarantees both rows exist and are
 * linked, creating whichever is missing.
 *
 * Matching (case-insensitive):
 *   1. existing shim by name that already has a linked org → reuse both
 *   2. existing production-company-type org by name → link/create the shim
 *   3. nothing → create a member-less org + shim, linked together
 *
 * The created organisation has no members; ownership is granted later via
 * invites (mirrors the concierge flow, which creates member-less orgs too).
 */
export async function resolveCompanyOrg(
  db: Db,
  opts: { name: string; createdBy: string; orgType?: OrgType }
): Promise<CompanyOrgRefs> {
  const name = opts.name.trim();
  const orgType: OrgType = opts.orgType ?? "production_company";
  const now = Math.floor(Date.now() / 1000);
  const lname = name.toLowerCase();

  // 1. Shim by name (production_companies.name is UNIQUE NOCASE).
  const company = await db
    .select({ id: productionCompanies.id })
    .from(productionCompanies)
    .where(sql`lower(${productionCompanies.name}) = ${lname}`)
    .get();

  if (company) {
    const linked = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.productionCompanyId, company.id))
      .get();
    if (linked) return { organisationId: linked.id, productionCompanyId: company.id };
  }

  // 2. A production-company-type org with a matching name.
  const orgByName = await db
    .select({ id: organisations.id, productionCompanyId: organisations.productionCompanyId })
    .from(organisations)
    .where(
      and(
        sql`lower(${organisations.name}) = ${lname}`,
        inArray(organisations.orgType, ["production_company", "studio"])
      )
    )
    .get();

  // Ensure a shim row exists.
  let companyId = company?.id ?? orgByName?.productionCompanyId ?? null;
  if (!companyId) {
    companyId = crypto.randomUUID();
    await db.insert(productionCompanies).values({ id: companyId, name, createdAt: now, updatedAt: now });
  }

  if (orgByName) {
    if (orgByName.productionCompanyId !== companyId) {
      await db
        .update(organisations)
        .set({ productionCompanyId: companyId, updatedAt: now })
        .where(eq(organisations.id, orgByName.id));
    }
    return { organisationId: orgByName.id, productionCompanyId: companyId };
  }

  // 3. Create a member-less org linked to the shim.
  const orgId = crypto.randomUUID();
  await db.insert(organisations).values({
    id: orgId,
    name,
    productionCompanyId: companyId,
    createdBy: opts.createdBy,
    createdAt: now,
    updatedAt: now,
    orgType,
  });
  await mintOrgCode(db, orgId, orgType);

  return { organisationId: orgId, productionCompanyId: companyId };
}
