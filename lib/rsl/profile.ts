/**
 * RSL profile persistence + lookup helpers.
 *
 * The rsl_profiles row carries only exposure controls + minimal public-card
 * fields; the posture is derived separately (lib/rsl/posture.ts).
 */

import { eq } from "drizzle-orm";
import { rslProfiles, users, talentProfiles } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export type RslProfile = typeof rslProfiles.$inferSelect;

export interface PublicLink {
  label: string;
  url: string;
}

/** Canonical platform base URL (matches lib/consent + the rest of the app). */
export function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
}

/** Public consent-profile page URL for a slug. */
export function consentProfileUrl(slug: string): string {
  return `${baseUrl()}/c/${slug}`;
}

/** Machine-readable RSL license document URL for a slug. */
export function licenseXmlUrl(slug: string): string {
  return `${baseUrl()}/api/rsl/${slug}/license.xml`;
}

/** Open License Protocol endpoint (declared now; implemented in Phase 2). */
export function olpServerUrl(): string {
  return `${baseUrl()}/api/rsl/olp`;
}

export function parseLinks(json: string | null | undefined): PublicLink[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (x): x is PublicLink =>
          !!x &&
          typeof (x as PublicLink).label === "string" &&
          typeof (x as PublicLink).url === "string",
      )
      .slice(0, 8)
      .map((x) => ({ label: x.label.slice(0, 80), url: x.url.slice(0, 300) }));
  } catch {
    return [];
  }
}

export async function getRslProfile(db: Db, talentId: string): Promise<RslProfile | undefined> {
  return db.select().from(rslProfiles).where(eq(rslProfiles.talentId, talentId)).get();
}

/** Get the talent's RSL profile, creating an empty (unpublished) one if absent. */
export async function ensureRslProfile(db: Db, talentId: string): Promise<RslProfile> {
  const existing = await getRslProfile(db, talentId);
  if (existing) return existing;
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(rslProfiles)
    .values({ id: crypto.randomUUID(), talentId, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  // Re-read to cover the race where a concurrent request inserted first.
  return (await getRslProfile(db, talentId))!;
}

export interface PublicProfileRow {
  profile: RslProfile;
  vaultLocked: boolean;
  fullName: string | null;
}

/** Resolve a profile by its public slug, with the talent's vault-lock state. */
export async function getProfileBySlug(
  db: Db,
  slug: string,
): Promise<PublicProfileRow | undefined> {
  const row = await db
    .select({
      profile: rslProfiles,
      vaultLocked: users.vaultLocked,
      fullName: talentProfiles.fullName,
    })
    .from(rslProfiles)
    .innerJoin(users, eq(users.id, rslProfiles.talentId))
    .leftJoin(talentProfiles, eq(talentProfiles.userId, rslProfiles.talentId))
    .where(eq(rslProfiles.publicSlug, slug))
    .get();
  if (!row) return undefined;
  return { profile: row.profile, vaultLocked: !!row.vaultLocked, fullName: row.fullName };
}
