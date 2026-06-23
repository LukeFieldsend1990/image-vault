// Union affiliation resolver (SPEC §16 — compliance roles, union read-only scope).
//
// A union-scoped compliance grant (complianceGrants.scope = "union", scope_id =
// the union id) gives a union watcher read-only visibility into the entities
// affiliated with their union:
//
//   • affiliated talent — on-platform talent on the union's member roster
//     (unionMembers), matched live by normalised name the same way the roster
//     coverage view does (never stored, so a member flips to affiliated the moment
//     they onboard);
//   • affiliated productions — the productions those affiliated talent are involved
//     in, via either a production cast slot (productionCast) or a licence
//     (licences) they hold.
//
// These resolvers take union ids (not a user) so they carry no dependency on the
// grants module — that keeps the import graph acyclic: grants.ts reads these,
// never the reverse.

import { and, inArray, isNull } from "drizzle-orm";
import { licences, productionCast, productions, talentProfiles, unionMembers } from "@/lib/db/schema";
import { normaliseName } from "./watchlist";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

// D1 caps bound parameters per statement (~100); chunk inArray lists well under it.
const CHUNK = 80;

function chunked<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

export interface AffiliatedTalent {
  talentId: string;
  name: string;
}

export interface AffiliatedProduction {
  id: string;
  name: string;
  status: string | null;
}

/**
 * On-platform talent affiliated with the given union(s): the union's active
 * member-roster names matched against talent profiles by normalised full name.
 */
export async function affiliatedTalent(db: Db, unionIds: string[]): Promise<AffiliatedTalent[]> {
  if (unionIds.length === 0) return [];

  const rosterRows = await db
    .select({ name: unionMembers.name })
    .from(unionMembers)
    .where(and(inArray(unionMembers.unionId, unionIds), isNull(unionMembers.archivedAt)))
    .all();
  if (rosterRows.length === 0) return [];

  const rosterKeys = new Set(rosterRows.map((r) => normaliseName(r.name)).filter(Boolean));
  if (rosterKeys.size === 0) return [];

  // Talent index by normalised name (first profile wins on a name collision).
  const talent = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .all();

  const out = new Map<string, AffiliatedTalent>();
  for (const t of talent) {
    const key = normaliseName(t.fullName);
    if (key && rosterKeys.has(key) && !out.has(t.userId)) {
      out.set(t.userId, { talentId: t.userId, name: t.fullName });
    }
  }
  return [...out.values()];
}

export async function affiliatedTalentIds(db: Db, unionIds: string[]): Promise<Set<string>> {
  return new Set((await affiliatedTalent(db, unionIds)).map((t) => t.talentId));
}

/** Production ids that the given affiliated talent are involved in (cast or licence). */
export async function productionIdsForTalent(db: Db, talentIds: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  if (talentIds.length === 0) return ids;

  for (const chunk of chunked(talentIds)) {
    const castRows = await db
      .select({ productionId: productionCast.productionId })
      .from(productionCast)
      .where(inArray(productionCast.talentId, chunk))
      .all();
    for (const r of castRows) if (r.productionId) ids.add(r.productionId);

    const licRows = await db
      .select({ productionId: licences.productionId })
      .from(licences)
      .where(inArray(licences.talentId, chunk))
      .all();
    for (const r of licRows) if (r.productionId) ids.add(r.productionId);
  }
  return ids;
}

/** Productions the union's affiliated talent are involved in, with name + status. */
export async function affiliatedProductions(db: Db, unionIds: string[]): Promise<AffiliatedProduction[]> {
  const talentIds = [...(await affiliatedTalentIds(db, unionIds))];
  const prodIds = [...(await productionIdsForTalent(db, talentIds))];
  if (prodIds.length === 0) return [];

  const rows: AffiliatedProduction[] = [];
  for (const chunk of chunked(prodIds)) {
    const prodRows = await db
      .select({ id: productions.id, name: productions.name, status: productions.status })
      .from(productions)
      .where(inArray(productions.id, chunk))
      .all();
    for (const p of prodRows) rows.push({ id: p.id, name: p.name, status: p.status });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export async function affiliatedProductionIds(db: Db, unionIds: string[]): Promise<Set<string>> {
  return new Set((await affiliatedProductions(db, unionIds)).map((p) => p.id));
}
