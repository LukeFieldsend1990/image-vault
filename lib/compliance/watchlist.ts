// Production watchlist (union oversight). Upcoming productions believed to be
// heading into pre-production that are not yet ratified on ImageVault. The union
// gets read visibility plus an outreach flag — onboarding is not mandated.
//
// "Ratified" is never stored: each read matches a watchlist entry against the live
// `productions` table (by tmdbId first, then normalised name) so an entry flips to
// "on ImageVault" automatically the moment a matching production is registered.

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { productionCompanies, productionWatchlist, productions, users } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface WatchlistEntry {
  id: string;
  name: string;
  companyName: string | null;
  tmdbId: number | null;
  type: string | null;
  expectedStage: string;
  expectedStartDate: number | null;
  source: string;
  notes: string | null;
  flaggedForOutreach: boolean;
  outreachNotes: string | null;
  addedByName: string | null;
  addedAt: number;
  unionId: string | null;
  // Derived ratification status
  ratified: boolean;
  matchedProductionId: string | null;
  matchedProductionName: string | null;
  matchedStatus: string | null;
  matchedCompanyName: string | null;
  matchedType: string | null;
}

// Exported for tests — the matcher that decides whether a watchlist entry has been
// ratified onto ImageVault by comparing against a production's name.
export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Active watchlist entries, each enriched with live ratification status. When
 *  `unionIds` is given, restricts to entries tagged with one of those unions —
 *  the per-union scoping watchers expect. Pass an empty array to get everything
 *  (admin view). */
export async function buildWatchlist(db: Db, unionIds?: string[]): Promise<WatchlistEntry[]> {
  const where = unionIds && unionIds.length > 0
    ? and(isNull(productionWatchlist.archivedAt), inArray(productionWatchlist.unionId, unionIds))
    : isNull(productionWatchlist.archivedAt);
  const entries = await db
    .select()
    .from(productionWatchlist)
    .where(where)
    .orderBy(desc(productionWatchlist.flaggedForOutreach), desc(productionWatchlist.addedAt))
    .all();
  if (entries.length === 0) return [];

  // Productions to match against — fields needed for matching + display enrichment.
  const prodRows = await db
    .select({
      id: productions.id,
      name: productions.name,
      tmdbId: productions.tmdbId,
      status: productions.status,
      type: productions.type,
      companyName: productionCompanies.name,
    })
    .from(productions)
    .leftJoin(productionCompanies, eq(productions.companyId, productionCompanies.id))
    .all();
  const byTmdb = new Map<number, (typeof prodRows)[number]>();
  const byName = new Map<string, (typeof prodRows)[number]>();
  for (const p of prodRows) {
    if (p.tmdbId != null) byTmdb.set(p.tmdbId, p);
    byName.set(normaliseName(p.name), p);
  }

  // Resolve who added each entry (batched).
  const adderIds = [...new Set(entries.map((e) => e.addedBy))];
  const adderEmail = new Map<string, string>();
  if (adderIds.length) {
    for (const u of await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, adderIds)).all()) {
      adderEmail.set(u.id, u.email);
    }
  }

  return entries.map((e) => {
    const match = (e.tmdbId != null ? byTmdb.get(e.tmdbId) : undefined) ?? byName.get(normaliseName(e.name));
    return {
      id: e.id,
      name: e.name,
      companyName: e.companyName,
      tmdbId: e.tmdbId,
      type: e.type,
      expectedStage: e.expectedStage,
      expectedStartDate: e.expectedStartDate,
      source: e.source,
      notes: e.notes,
      flaggedForOutreach: e.flaggedForOutreach,
      outreachNotes: e.outreachNotes,
      addedByName: adderEmail.get(e.addedBy) ?? null,
      addedAt: e.addedAt,
      unionId: e.unionId,
      ratified: !!match,
      matchedProductionId: match?.id ?? null,
      matchedProductionName: match?.name ?? null,
      matchedStatus: match?.status ?? null,
      matchedCompanyName: match?.companyName ?? null,
      matchedType: match?.type ?? null,
    };
  });
}

export interface AddWatchlistInput {
  name: string;
  companyName?: string | null;
  tmdbId?: number | null;
  type?: string | null;
  expectedStage?: string | null;
  expectedStartDate?: number | null;
  source?: "tmdb" | "manual";
  notes?: string | null;
  addedBy: string;
  unionId?: string | null;
}

const STAGES = new Set(["development", "pre_production", "production", "unknown"]);
const TYPES = new Set(["film", "tv_series", "tv_movie", "commercial", "game", "music_video", "other"]);

/** Add an entry. Returns the new id, or null if a non-archived entry on the
 *  same union list already tracks the same TMDB id. Per-union scoping means
 *  SAG and Equity may independently watch the same upcoming production. */
export async function addWatchlistEntry(db: Db, input: AddWatchlistInput): Promise<string | null> {
  if (input.tmdbId != null) {
    const existingRows = await db
      .select({ id: productionWatchlist.id, unionId: productionWatchlist.unionId, archivedAt: productionWatchlist.archivedAt })
      .from(productionWatchlist)
      .where(eq(productionWatchlist.tmdbId, input.tmdbId))
      .all();
    const dup = existingRows.find((r) => r.archivedAt == null && (r.unionId ?? null) === (input.unionId ?? null));
    if (dup) return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await db.insert(productionWatchlist).values({
    id,
    name: input.name.trim(),
    companyName: input.companyName?.trim() || null,
    tmdbId: input.tmdbId ?? null,
    type: TYPES.has(input.type ?? "") ? (input.type as "film") : null,
    expectedStage: STAGES.has(input.expectedStage ?? "") ? (input.expectedStage as "pre_production") : "pre_production",
    expectedStartDate: input.expectedStartDate ?? null,
    source: input.source ?? "manual",
    notes: input.notes?.trim() || null,
    addedBy: input.addedBy,
    addedAt: now,
    updatedAt: now,
    unionId: input.unionId ?? null,
  });
  return id;
}

export interface UpdateWatchlistInput {
  companyName?: string | null;
  type?: string | null;
  expectedStage?: string | null;
  expectedStartDate?: number | null;
  notes?: string | null;
  flaggedForOutreach?: boolean;
  outreachNotes?: string | null;
}

export async function updateWatchlistEntry(db: Db, id: string, patch: UpdateWatchlistInput): Promise<boolean> {
  const existing = await db.select({ id: productionWatchlist.id }).from(productionWatchlist).where(eq(productionWatchlist.id, id)).get();
  if (!existing) return false;

  const set: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) };
  if (patch.companyName !== undefined) set.companyName = patch.companyName?.trim() || null;
  if (patch.type !== undefined) set.type = TYPES.has(patch.type ?? "") ? patch.type : null;
  if (patch.expectedStage !== undefined && STAGES.has(patch.expectedStage ?? "")) set.expectedStage = patch.expectedStage;
  if (patch.expectedStartDate !== undefined) set.expectedStartDate = patch.expectedStartDate;
  if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
  if (patch.flaggedForOutreach !== undefined) set.flaggedForOutreach = patch.flaggedForOutreach;
  if (patch.outreachNotes !== undefined) set.outreachNotes = patch.outreachNotes?.trim() || null;

  await db.update(productionWatchlist).set(set).where(eq(productionWatchlist.id, id));
  return true;
}

/** The union id (if any) a watchlist entry belongs to — used for per-call scope
 *  checks before patch/delete. */
export async function getWatchlistEntryUnionId(db: Db, id: string): Promise<string | null | undefined> {
  const row = await db
    .select({ unionId: productionWatchlist.unionId })
    .from(productionWatchlist)
    .where(eq(productionWatchlist.id, id))
    .get();
  return row ? (row.unionId ?? null) : undefined;
}

/** Soft-remove (archive) an entry so it drops off the active watchlist. */
export async function archiveWatchlistEntry(db: Db, id: string): Promise<boolean> {
  const existing = await db.select({ id: productionWatchlist.id }).from(productionWatchlist).where(eq(productionWatchlist.id, id)).get();
  if (!existing) return false;
  await db.update(productionWatchlist).set({ archivedAt: Math.floor(Date.now() / 1000) }).where(eq(productionWatchlist.id, id));
  return true;
}

/** TMDB ids already on the active watchlist — used to dedupe discovery
 *  candidates. Scoped per union so a SAG watcher's "already on watchlist"
 *  signal isn't polluted by Equity's list. */
export async function activeWatchlistTmdbIds(db: Db, unionIds?: string[]): Promise<Set<number>> {
  const where = unionIds && unionIds.length > 0
    ? and(isNull(productionWatchlist.archivedAt), inArray(productionWatchlist.unionId, unionIds))
    : isNull(productionWatchlist.archivedAt);
  const rows = await db
    .select({ tmdbId: productionWatchlist.tmdbId })
    .from(productionWatchlist)
    .where(where)
    .all();
  return new Set(rows.map((r) => r.tmdbId).filter((t): t is number => t != null));
}
