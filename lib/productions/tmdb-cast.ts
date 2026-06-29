/**
 * Shared TMDB cast fetch + talent-matching.
 *
 * Used by GET /api/productions/[id]/cast/tmdb (display) and
 * POST /api/productions/[id]/cast/tmdb/import (bulk placeholder import) so the
 * two paths fetch and match identically.
 */

import { talentProfiles, users, productionCast } from "@/lib/db/schema";
import { eq, inArray, or, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface MatchedCastMember {
  tmdbId: number;
  name: string;
  character: string;
  department: string;        // always "Acting"
  profilePath?: string;
  matched: boolean;          // true if a talent account already exists on Image Vault
  talentId?: string;
  talentEmail?: string;
}

interface TmdbCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

interface TmdbCreditsResponse {
  cast: TmdbCastMember[];
}

export type TmdbCastResult =
  | { ok: true; cast: MatchedCastMember[] }
  | { ok: false; status: number; error: string };

/**
 * Fetch a production's TMDB billed cast and tag each member with whether a
 * matching talent account already exists (by tmdbId, falling back to name).
 */
export async function fetchTmdbCastWithMatches(
  db: Db,
  production: { type: string | null; tmdbId: number | null },
  overrideTmdbId?: number | null,
): Promise<TmdbCastResult> {
  const tmdbId = overrideTmdbId ?? production.tmdbId;
  if (!tmdbId) return { ok: false, status: 422, error: "Production isn't linked to an online title" };

  const tmdbKey = process.env.TMDB_API_KEY;
  if (!tmdbKey) return { ok: false, status: 503, error: "Online cast lookup not configured" };

  const mediaType = production.type === "tv_series" ? "tv" : "movie";
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/credits?api_key=${tmdbKey}`;

  let tmdbData: TmdbCreditsResponse;
  try {
    const res = await fetch(tmdbUrl);
    if (!res.ok) return { ok: false, status: 502, error: "Online cast lookup failed" };
    tmdbData = (await res.json()) as TmdbCreditsResponse;
  } catch {
    return { ok: false, status: 502, error: "Failed to fetch online credits" };
  }

  const castList = tmdbData.cast ?? [];
  if (castList.length === 0) return { ok: true, cast: [] };

  // Match only against the profiles that could plausibly match this cast list —
  // by tmdbId, or by normalized name — instead of loading every profile on the
  // platform. Build lookup maps (by tmdbId, then normalized name).
  const castTmdbIds = Array.from(new Set(castList.map((c) => c.id)));
  const castNames = Array.from(new Set(castList.map((c) => c.name.toLowerCase())));
  const profileMatchers = [
    castTmdbIds.length > 0 ? inArray(talentProfiles.tmdbId, castTmdbIds) : undefined,
    castNames.length > 0 ? inArray(sql`lower(${talentProfiles.fullName})`, castNames) : undefined,
  ].filter(Boolean);

  const profiles = profileMatchers.length > 0
    ? await db
        .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName, tmdbId: talentProfiles.tmdbId })
        .from(talentProfiles)
        .where(or(...profileMatchers))
        .all()
    : [];

  const byTmdbId = new Map<number, typeof profiles[0]>();
  const byName = new Map<string, typeof profiles[0]>();
  for (const p of profiles) {
    if (p.tmdbId !== null && p.tmdbId !== undefined) byTmdbId.set(p.tmdbId, p);
    byName.set(p.fullName.toLowerCase(), p);
  }

  const matchedUserIds = new Set<string>();
  for (const c of castList) {
    const match = byTmdbId.get(c.id) ?? byName.get(c.name.toLowerCase());
    if (match) matchedUserIds.add(match.userId);
  }

  const userEmailMap = new Map<string, string>();
  if (matchedUserIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, Array.from(matchedUserIds)))
      .all();
    for (const u of userRows) userEmailMap.set(u.id, u.email);
  }

  const cast: MatchedCastMember[] = castList.map((c) => {
    const match = byTmdbId.get(c.id) ?? byName.get(c.name.toLowerCase());
    return {
      tmdbId: c.id,
      name: c.name,
      character: c.character,
      department: "Acting",
      profilePath: c.profile_path ?? undefined,
      matched: match !== undefined,
      talentId: match?.userId ?? undefined,
      talentEmail: match ? (userEmailMap.get(match.userId) ?? undefined) : undefined,
    };
  });

  return { ok: true, cast };
}

export interface ImportPlaceholdersResult {
  imported: number;
  skipped: number;
  matched: number;
  total: number;
}

/**
 * Fetch a production's TMDB cast and insert any not-yet-present members as
 * placeholder rows (deduped on tmdbId — merge, don't clobber). Shared by the
 * bulk-import endpoint and the admin concierge setup. `subset` limits to those
 * tmdbIds; omit to import everyone.
 */
export async function importTmdbPlaceholders(
  db: Db,
  opts: {
    productionId: string;
    production: { type: string | null; tmdbId: number | null };
    addedBy: string;
    subset?: Set<number> | null;
    overrideTmdbId?: number | null;
  },
): Promise<ImportPlaceholdersResult | { error: string; status: number }> {
  const result = await fetchTmdbCastWithMatches(db, opts.production, opts.overrideTmdbId);
  if (!result.ok) return { error: result.error, status: result.status };

  let members = result.cast;
  if (opts.subset) members = members.filter((m) => opts.subset!.has(m.tmdbId));

  const existing = await db
    .select({ tmdbId: productionCast.tmdbId })
    .from(productionCast)
    .where(eq(productionCast.productionId, opts.productionId))
    .all();
  const existingTmdbIds = new Set(existing.map((r) => r.tmdbId).filter((t): t is number => t !== null));

  const now = Math.floor(Date.now() / 1000);
  let skipped = 0, matched = 0;

  const toInsert = [] as (typeof productionCast.$inferInsert)[];
  for (const m of members) {
    if (existingTmdbIds.has(m.tmdbId)) { skipped++; continue; }
    existingTmdbIds.add(m.tmdbId);
    if (m.matched) matched++;
    toInsert.push({
      id: crypto.randomUUID(),
      productionId: opts.productionId,
      talentId: null,
      inviteId: null,
      licenceId: null,
      actorName: m.name,
      tmdbId: m.tmdbId,
      sourceNote: "TMDB credits",
      characterName: m.character || null,
      department: m.department,
      sagMember: false,
      status: "placeholder",
      licenceTermsJson: null,
      addedBy: opts.addedBy,
      addedAt: now,
      linkedAt: null,
    });
  }

  // Single multi-row insert instead of one round-trip per cast member.
  if (toInsert.length > 0) {
    await db.insert(productionCast).values(toInsert);
  }

  return { imported: toInsert.length, skipped, matched, total: members.length };
}
