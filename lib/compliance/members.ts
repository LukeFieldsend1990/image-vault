// Union member roster. A union uploads its membership as plain comma/newline-
// separated names; the platform matches each against talent profiles so the union
// can see who is already on Image Vault and who is not. Visibility only — onboarding
// is never mandated. Match status is derived at read time (never stored) so a member
// flips to "on platform" the moment they onboard.

import { desc, eq, inArray, isNull } from "drizzle-orm";
import { talentProfiles, unionMembers, users } from "@/lib/db/schema";
import { normaliseName } from "./watchlist";
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

/** Active roster with live on-platform matching + a coverage summary. */
export async function buildMemberRoster(db: Db): Promise<MemberRoster> {
  const rows = await db
    .select()
    .from(unionMembers)
    .where(isNull(unionMembers.archivedAt))
    .orderBy(desc(unionMembers.addedAt))
    .all();

  if (rows.length === 0) return { members: [], total: 0, onPlatform: 0, coveragePct: 100 };

  // Talent on the platform, keyed by normalised name.
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

/** Append names to the roster, skipping any already present (by normalised name).
 *  Returns how many were newly added. */
export async function addMembers(db: Db, names: string[], addedBy: string): Promise<{ added: number; skipped: number }> {
  if (names.length === 0) return { added: 0, skipped: 0 };

  const existing = await db
    .select({ name: unionMembers.name })
    .from(unionMembers)
    .where(isNull(unionMembers.archivedAt))
    .all();
  const existingKeys = new Set(existing.map((e) => normaliseName(e.name)));

  const now = Math.floor(Date.now() / 1000);
  const toInsert = names
    .filter((n) => !existingKeys.has(normaliseName(n)))
    .map((name) => ({ id: crypto.randomUUID(), name, addedBy, addedAt: now, archivedAt: null }));

  // D1 caps bound parameters at ~100 per statement; 5 columns × 20 rows = 100 params.
  for (let i = 0; i < toInsert.length; i += 20) {
    await db.insert(unionMembers).values(toInsert.slice(i, i + 20));
  }

  return { added: toInsert.length, skipped: names.length - toInsert.length };
}

export async function archiveMember(db: Db, id: string): Promise<boolean> {
  const existing = await db.select({ id: unionMembers.id }).from(unionMembers).where(eq(unionMembers.id, id)).get();
  if (!existing) return false;
  await db.update(unionMembers).set({ archivedAt: Math.floor(Date.now() / 1000) }).where(eq(unionMembers.id, id));
  return true;
}

/** Clear the whole active roster (soft-archive every member). Returns count cleared. */
export async function clearRoster(db: Db): Promise<number> {
  const active = await db.select({ id: unionMembers.id }).from(unionMembers).where(isNull(unionMembers.archivedAt)).all();
  if (active.length === 0) return 0;
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(unionMembers)
    .set({ archivedAt: now })
    .where(inArray(unionMembers.id, active.map((a) => a.id)));
  return active.length;
}
