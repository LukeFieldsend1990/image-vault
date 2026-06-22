// Union member roster. A union uploads its membership as plain comma/newline-
// separated names; the platform matches each against talent profiles so the union
// can see who is already on Image Vault and who is not. Visibility only — onboarding
// is never mandated. Match status is derived at read time (never stored) so a member
// flips to "on platform" the moment they onboard.

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { talentProfiles, unionMembers, users } from "@/lib/db/schema";
import { normaliseName } from "./watchlist";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getUnionIdsForUser } from "./grants";
import { UNION_PRESETS, getUnionPreset } from "./unions";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface MemberRow {
  id: string;
  name: string;
  addedAt: number;
  onPlatform: boolean;
  matchedTalentId: string | null;
  matchedEmail: string | null;
}

export interface MemberRoster {
  members: MemberRow[];
  total: number;
  onPlatform: number;
  coveragePct: number; // onPlatform / total * 100
}

/** Parse a pasted blob of comma- and/or newline-separated names into clean tokens. */
export function parseMemberNames(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[,\n\r]+/)) {
    const name = token.trim().replace(/\s+/g, " ");
    if (!name) continue;
    const key = normaliseName(name);
    if (!key || seen.has(key)) continue; // drop blanks + in-batch dupes
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Talent on the platform, keyed by normalised full name. */
async function loadTalentByName(db: Db): Promise<Map<string, { userId: string; email: string | null }>> {
  const talent = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName, email: users.email })
    .from(talentProfiles)
    .leftJoin(users, eq(talentProfiles.userId, users.id))
    .all();
  const byName = new Map<string, { userId: string; email: string | null }>();
  for (const t of talent) {
    const key = normaliseName(t.fullName);
    if (key && !byName.has(key)) byName.set(key, { userId: t.userId, email: t.email });
  }
  return byName;
}

/** Active roster for one union with live on-platform matching + a coverage summary. */
export async function buildMemberRoster(db: Db, unionId: string): Promise<MemberRoster> {
  const rows = await db
    .select()
    .from(unionMembers)
    .where(and(eq(unionMembers.unionId, unionId), isNull(unionMembers.archivedAt)))
    .orderBy(desc(unionMembers.addedAt))
    .all();

  if (rows.length === 0) return { members: [], total: 0, onPlatform: 0, coveragePct: 100 };

  const byName = await loadTalentByName(db);

  let onPlatform = 0;
  const members: MemberRow[] = rows.map((r) => {
    const match = byName.get(normaliseName(r.name));
    if (match) onPlatform++;
    return {
      id: r.id,
      name: r.name,
      addedAt: r.addedAt,
      onPlatform: !!match,
      matchedTalentId: match?.userId ?? null,
      matchedEmail: match?.email ?? null,
    };
  });

  return {
    members,
    total: members.length,
    onPlatform,
    coveragePct: members.length ? Math.round((onPlatform / members.length) * 100) : 100,
  };
}

/** Append names to a union's roster, skipping any already present in that union (by
 *  normalised name). Returns how many were newly added. */
export async function addMembers(
  db: Db,
  names: string[],
  addedBy: string,
  unionId: string,
): Promise<{ added: number; skipped: number }> {
  if (names.length === 0) return { added: 0, skipped: 0 };

  const existing = await db
    .select({ name: unionMembers.name })
    .from(unionMembers)
    .where(and(eq(unionMembers.unionId, unionId), isNull(unionMembers.archivedAt)))
    .all();
  const existingKeys = new Set(existing.map((e) => normaliseName(e.name)));

  const now = Math.floor(Date.now() / 1000);
  const toInsert = names
    .filter((n) => !existingKeys.has(normaliseName(n)))
    .map((name) => ({ id: crypto.randomUUID(), name, unionId, addedBy, addedAt: now, archivedAt: null }));

  // D1 caps bound parameters at ~100 per statement; 6 columns × 16 rows = 96 params.
  for (let i = 0; i < toInsert.length; i += 16) {
    await db.insert(unionMembers).values(toInsert.slice(i, i + 16));
  }

  return { added: toInsert.length, skipped: names.length - toInsert.length };
}

/** Soft-remove one member, scoped to a union so a watcher can't touch another's roster. */
export async function archiveMember(db: Db, id: string, unionId: string): Promise<boolean> {
  const existing = await db
    .select({ id: unionMembers.id })
    .from(unionMembers)
    .where(and(eq(unionMembers.id, id), eq(unionMembers.unionId, unionId)))
    .get();
  if (!existing) return false;
  await db.update(unionMembers).set({ archivedAt: Math.floor(Date.now() / 1000) }).where(eq(unionMembers.id, id));
  return true;
}

/** Clear one union's active roster (soft-archive every member). Returns count cleared. */
export async function clearRoster(db: Db, unionId: string): Promise<number> {
  const active = await db
    .select({ id: unionMembers.id })
    .from(unionMembers)
    .where(and(eq(unionMembers.unionId, unionId), isNull(unionMembers.archivedAt)))
    .all();
  if (active.length === 0) return 0;
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(unionMembers)
    .set({ archivedAt: now })
    .where(inArray(unionMembers.id, active.map((a) => a.id)));
  return active.length;
}

export interface RosterUnionContext {
  /** Unions the caller may manage a roster for (admins: all presets). */
  available: { id: string; shortName: string }[];
  /** The selected union — the requested one (if permitted) or the first available. */
  unionId: string;
}

/**
 * Resolve which union's roster a caller is acting on. Admins manage any preset;
 * a union watcher manages only the union(s) of their platform-scoped grants.
 * Returns an error shape (mapped to a 4xx by the route) when the caller has no
 * union to manage, or requested one they don't hold.
 */
export async function resolveRosterUnion(
  db: Db,
  session: { sub: string; email: string; role: string },
  requested?: string | null,
): Promise<RosterUnionContext | { error: string; status: number }> {
  const available = isAdmin(session.email)
    ? UNION_PRESETS.map((u) => ({ id: u.id, shortName: u.shortName }))
    : (await getUnionIdsForUser(db, session.sub, { platformOnly: true })).map((id) => ({
        id,
        shortName: getUnionPreset(id)?.shortName ?? id,
      }));

  if (available.length === 0) return { error: "Forbidden", status: 403 };

  if (requested) {
    if (!available.some((a) => a.id === requested)) return { error: "No access to that union", status: 403 };
    return { available, unionId: requested };
  }
  return { available, unionId: available[0].id };
}

export interface UnionCoverage {
  total: number;
  onPlatform: number;
  coveragePct: number;
}

/** Roster coverage per union in a single pass — for the admin console union cards. */
export async function rosterCoverageByUnion(db: Db): Promise<Record<string, UnionCoverage>> {
  const rows = await db
    .select({ name: unionMembers.name, unionId: unionMembers.unionId })
    .from(unionMembers)
    .where(isNull(unionMembers.archivedAt))
    .all();
  if (rows.length === 0) return {};

  const byName = await loadTalentByName(db);
  const acc: Record<string, { total: number; onPlatform: number }> = {};
  for (const r of rows) {
    if (!r.unionId) continue; // legacy, unattributed
    const a = (acc[r.unionId] ??= { total: 0, onPlatform: 0 });
    a.total++;
    if (byName.has(normaliseName(r.name))) a.onPlatform++;
  }

  const out: Record<string, UnionCoverage> = {};
  for (const [unionId, a] of Object.entries(acc)) {
    out[unionId] = {
      total: a.total,
      onPlatform: a.onPlatform,
      coveragePct: a.total ? Math.round((a.onPlatform / a.total) * 100) : 100,
    };
  }
  return out;
}
