/**
 * Path D — self-heal cast resolution.
 *
 * When a talent organically joins Image Vault (rather than via a cast-scoped
 * invite), match them against open placeholder cast rows reserved across all
 * productions, let them claim the role, and notify the production company.
 *
 * Privacy: claiming links the cast row and tells the production company that a
 * role was claimed — it never exposes the talent's contact details. The licence
 * itself still flows through the normal request machinery.
 *
 * Collision guard: a tmdbId match is strong (safe to surface proactively); a
 * name-only match is weak and only ever acted on by the talent's explicit
 * confirmation (the claim action itself).
 */

import { eq, and, or, isNull, notExists, sql } from "drizzle-orm";
import {
  productionCast,
  productions,
  productionCompanies,
  organisations,
  talentProfiles,
  organisationMembers,
  users,
  castClaimDismissals,
} from "@/lib/db/schema";
import { createNotification } from "@/lib/notifications/create";
import { sendEmail } from "@/lib/email/send";
import { productionRoleClaimedEmail } from "@/lib/email/templates";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface ClaimableRole {
  castId: string;
  productionId: string;
  productionName: string;
  companyName: string;
  characterName: string | null;
  matchType: "tmdb" | "name";
}

// Company label for a production: organisation, else production company, else
// generic. Resolved via LEFT JOINs (see findClaimableRoles) rather than a
// correlated subquery per row.
const companyNameSql = sql<string>`coalesce(${organisations.name}, ${productionCompanies.name}, 'a production company')`;

/**
 * Find open placeholder roles that match a talent (by tmdbId, falling back to
 * normalized name). Returns [] if the talent has no profile yet.
 */
export async function findClaimableRoles(db: Db, talentUserId: string): Promise<ClaimableRole[]> {
  const profile = await db
    .select({ tmdbId: talentProfiles.tmdbId, fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, talentUserId))
    .get();
  if (!profile) return [];

  const nameKey = profile.fullName.trim().toLowerCase();
  const matchers = [] as ReturnType<typeof sql>[];
  if (profile.tmdbId != null) matchers.push(sql`${productionCast.tmdbId} = ${profile.tmdbId}`);
  if (nameKey) matchers.push(sql`lower(${productionCast.actorName}) = ${nameKey}`);
  if (matchers.length === 0) return [];

  const rows = await db
    .select({
      castId: productionCast.id,
      productionId: productionCast.productionId,
      characterName: productionCast.characterName,
      tmdbId: productionCast.tmdbId,
      productionName: productions.name,
      companyName: companyNameSql,
    })
    .from(productionCast)
    .innerJoin(productions, eq(productions.id, productionCast.productionId))
    .leftJoin(organisations, eq(organisations.id, productions.organisationId))
    .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
    .where(and(
      eq(productionCast.status, "placeholder"),
      isNull(productionCast.talentId),
      or(...matchers),
      notExists(
        db.select({ x: sql`1` }).from(castClaimDismissals).where(
          and(
            eq(castClaimDismissals.castId, productionCast.id),
            eq(castClaimDismissals.talentId, talentUserId),
          ),
        ),
      ),
    ))
    .all();

  return rows.map((r) => ({
    castId: r.castId,
    productionId: r.productionId,
    productionName: r.productionName,
    companyName: r.companyName,
    characterName: r.characterName,
    matchType: profile.tmdbId != null && r.tmdbId === profile.tmdbId ? "tmdb" : "name",
  }));
}

export interface ClaimResult {
  ok: boolean;
  message: string;
  productionId?: string;
}

/**
 * Claim a reserved role for a talent. Re-verifies the match server-side (the
 * talent can only claim a row that actually matches their tmdbId or name), links
 * the cast row, and notifies the production company (in-app + email).
 */
export async function claimRole(
  db: Db,
  opts: { talentUserId: string; productionId: string; castId: string; baseUrl: string },
): Promise<ClaimResult> {
  const profile = await db
    .select({ tmdbId: talentProfiles.tmdbId, fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, opts.talentUserId))
    .get();
  if (!profile) return { ok: false, message: "Complete your profile before claiming a role." };

  const row = await db
    .select({
      id: productionCast.id,
      status: productionCast.status,
      talentId: productionCast.talentId,
      tmdbId: productionCast.tmdbId,
      actorName: productionCast.actorName,
      characterName: productionCast.characterName,
      addedBy: productionCast.addedBy,
    })
    .from(productionCast)
    .where(and(eq(productionCast.id, opts.castId), eq(productionCast.productionId, opts.productionId)))
    .get();
  if (!row) return { ok: false, message: "That reserved role no longer exists." };
  if (row.talentId || row.status !== "placeholder") {
    return { ok: false, message: "That role has already been filled." };
  }

  // Re-verify the match — never let a talent claim a role that isn't theirs.
  const tmdbMatch = profile.tmdbId != null && row.tmdbId === profile.tmdbId;
  const nameMatch = !!row.actorName && row.actorName.trim().toLowerCase() === profile.fullName.trim().toLowerCase();
  if (!tmdbMatch && !nameMatch) {
    return { ok: false, message: "This role doesn't match your profile." };
  }

  const now = Math.floor(Date.now() / 1000);
  await db.update(productionCast).set({
    talentId: opts.talentUserId,
    status: "linked",
    linkedAt: now,
  }).where(eq(productionCast.id, opts.castId));

  // Notify the production company (best-effort, never blocks the claim).
  void notifyProductionOfClaim(db, {
    productionId: opts.productionId,
    castId: opts.castId,
    talentName: profile.fullName,
    characterName: row.characterName,
    addedBy: row.addedBy,
    baseUrl: opts.baseUrl,
  });

  return { ok: true, message: "Role claimed.", productionId: opts.productionId };
}

/**
 * Record that a talent has said "Not me" for a cast placeholder. Idempotent.
 * Excluded from findClaimableRoles for this talent on all future calls.
 */
export async function dismissCast(db: Db, talentUserId: string, castId: string): Promise<void> {
  await db.insert(castClaimDismissals).values({
    id: crypto.randomUUID(),
    talentId: talentUserId,
    castId,
    dismissedAt: Math.floor(Date.now() / 1000),
  }).onConflictDoNothing();
}

async function notifyProductionOfClaim(
  db: Db,
  opts: { productionId: string; castId: string; talentName: string; characterName: string | null; addedBy: string; baseUrl: string },
): Promise<void> {
  try {
    const production = await db
      .select({ name: productions.name, organisationId: productions.organisationId })
      .from(productions)
      .where(eq(productions.id, opts.productionId))
      .get();
    if (!production) return;

    // Recipients: org owners/admins + whoever reserved the role.
    const recipients = new Set<string>([opts.addedBy]);
    if (production.organisationId) {
      const members = await db
        .select({ userId: organisationMembers.userId, memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(eq(organisationMembers.organisationId, production.organisationId))
        .all();
      members
        .filter((m) => m.memberRole === "owner" || m.memberRole === "admin")
        .forEach((m) => recipients.add(m.userId));
    }

    const href = `/productions/${opts.productionId}`;
    const title = `${opts.talentName} claimed their role`;
    const body = `${opts.talentName} joined Image Vault and claimed ${opts.characterName ? `the role of ${opts.characterName}` : "their reserved role"} in ${production.name}. Send them a licence request.`;

    await Promise.all(
      Array.from(recipients).map((userId) =>
        createNotification(db, { userId, type: "cast_claimed", title, body, href }),
      ),
    );

    // Email the coordinator who reserved the role.
    const coordinator = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, opts.addedBy))
      .get();
    if (coordinator?.email) {
      const { subject, html } = productionRoleClaimedEmail({
        recipientEmail: coordinator.email,
        talentName: opts.talentName,
        productionName: production.name,
        characterName: opts.characterName ?? undefined,
        reviewUrl: `${opts.baseUrl}${href}`,
      });
      await sendEmail({ to: coordinator.email, subject, html }).catch(() => {});
    }
  } catch {
    // best-effort
  }
}
