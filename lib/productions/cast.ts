/**
 * Shared production-cast helpers.
 *
 * promoteCastMember turns a `placeholder` cast row (recorded by name only) into
 * a real onboarding step once an email is attached: an existing talent account
 * gets a placeholder AWAITING_PACKAGE licence + a request email; an unknown
 * email gets a 7-day talent signup invite with the licence terms stored. The
 * cast row is updated in place (same castId), preserving history.
 *
 * Reused by the resolve_cast_member MCP tool and POST /api/productions/[id]/cast/[castId]/resolve
 * so the two paths can't drift.
 */

import {
  users,
  invites,
  licences,
  productions,
  productionCast,
  productionDefaultTerms,
} from "@/lib/db/schema";
import { eq, and, isNull, gt, sql } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { mintLicenceCode } from "@/lib/codes/codes";
import {
  productionCastInviteEmail,
  productionCastLinkedEmail,
} from "@/lib/email/templates";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export const CAST_LICENCE_TYPES = [
  "film_double", "game_character", "commercial", "ai_avatar", "training_data", "monitoring_reference",
] as const;
export const CAST_EXCLUSIVITIES = ["non_exclusive", "sole", "exclusive"] as const;

export type CastLicenceType = (typeof CAST_LICENCE_TYPES)[number];
export type CastExclusivity = (typeof CAST_EXCLUSIVITIES)[number];

/** Licence terms carried on a cast row (stored in licence_terms_json) or supplied at resolve time. */
export interface CastLicenceTerms {
  intendedUse?: string;
  validFrom?: number; // unix seconds
  validTo?: number;   // unix seconds
  licenceType?: CastLicenceType | null;
  territory?: string | null;
  exclusivity?: CastExclusivity;
  permitAiTraining?: boolean;
  proposedFee?: number | null; // cents
}

export interface PromoteResult {
  ok: boolean;
  message: string;
  status?: "linked" | "invited";
  licenceId?: string;
  inviteId?: string;
}

// Display company name for cast emails: production's organisation, else its
// production company, else a generic label.
const companyNameSql = sql<string>`coalesce(
  (SELECT name FROM organisations WHERE id = ${productions.organisationId}),
  (SELECT name FROM production_companies WHERE id = ${productions.companyId}),
  'Production Company'
)`;

function normaliseType(v: unknown): CastLicenceType | null {
  return CAST_LICENCE_TYPES.includes(v as CastLicenceType) ? (v as CastLicenceType) : null;
}

function normaliseExclusivity(v: unknown): CastExclusivity {
  return CAST_EXCLUSIVITIES.includes(v as CastExclusivity) ? (v as CastExclusivity) : "non_exclusive";
}

/** Load a production's default licence terms (Step 4 of guided onboarding), if set. */
export async function loadProductionDefaultTerms(db: Db, productionId: string): Promise<CastLicenceTerms> {
  const row = await db
    .select({
      intendedUse: productionDefaultTerms.intendedUse,
      validFrom: productionDefaultTerms.validFrom,
      validTo: productionDefaultTerms.validTo,
      licenceType: productionDefaultTerms.licenceType,
      territory: productionDefaultTerms.territory,
      exclusivity: productionDefaultTerms.exclusivity,
      permitAiTraining: productionDefaultTerms.permitAiTraining,
      proposedFee: productionDefaultTerms.proposedFee,
    })
    .from(productionDefaultTerms)
    .where(eq(productionDefaultTerms.productionId, productionId))
    .get();
  if (!row) return {};
  return {
    intendedUse: row.intendedUse ?? undefined,
    validFrom: row.validFrom ?? undefined,
    validTo: row.validTo ?? undefined,
    licenceType: normaliseType(row.licenceType),
    territory: row.territory ?? undefined,
    exclusivity: row.exclusivity ? normaliseExclusivity(row.exclusivity) : undefined,
    permitAiTraining: row.permitAiTraining ?? undefined,
    proposedFee: row.proposedFee ?? undefined,
  };
}

/**
 * Promote a placeholder cast row by attaching an email.
 * `overrides` (any provided fields) take precedence over the row's stored terms.
 */
export async function promoteCastMember(
  db: Db,
  opts: {
    productionId: string;
    castId: string;
    email: string;
    actorUserId: string;  // who is performing the promotion (becomes licensee/inviter)
    actorEmail: string;   // shown to the actor as the coordinator
    baseUrl: string;
    overrides?: CastLicenceTerms;
    defaults?: CastLicenceTerms;  // lowest precedence: production-level default terms
  }
): Promise<PromoteResult> {
  const email = opts.email.trim().toLowerCase();
  if (!email || !email.includes("@")) return { ok: false, message: "A valid email is required." };

  const cast = await db
    .select({
      id: productionCast.id,
      status: productionCast.status,
      characterName: productionCast.characterName,
      licenceTermsJson: productionCast.licenceTermsJson,
    })
    .from(productionCast)
    .where(and(eq(productionCast.id, opts.castId), eq(productionCast.productionId, opts.productionId)))
    .get();
  if (!cast) return { ok: false, message: "Cast member not found on this production." };
  if (cast.status !== "placeholder") {
    return { ok: false, message: `Cast member is already "${cast.status}", not a placeholder.` };
  }

  const production = await db
    .select({ id: productions.id, name: productions.name, company: companyNameSql })
    .from(productions)
    .where(eq(productions.id, opts.productionId))
    .get();
  if (!production) return { ok: false, message: "Production not found." };

  // Merge terms by precedence: explicit overrides > per-row stored > production defaults.
  let stored: CastLicenceTerms = {};
  if (cast.licenceTermsJson) {
    try { stored = JSON.parse(cast.licenceTermsJson) as CastLicenceTerms; } catch { stored = {}; }
  }
  const o = opts.overrides ?? {};
  const d = opts.defaults ?? {};
  const intendedUse = (o.intendedUse ?? stored.intendedUse ?? d.intendedUse ?? "").trim();
  const validFrom = o.validFrom ?? stored.validFrom ?? d.validFrom;
  const validTo = o.validTo ?? stored.validTo ?? d.validTo;
  const licenceType = normaliseType(o.licenceType ?? stored.licenceType ?? d.licenceType);
  const territory = (o.territory ?? stored.territory ?? d.territory) || null;
  const exclusivity = normaliseExclusivity(o.exclusivity ?? stored.exclusivity ?? d.exclusivity);
  const permitAiTraining = o.permitAiTraining ?? stored.permitAiTraining ?? d.permitAiTraining ?? false;
  const proposedFee = o.proposedFee ?? stored.proposedFee ?? d.proposedFee ?? null;

  if (!intendedUse) return { ok: false, message: "intendedUse is required to resolve a placeholder (supply it or store it on the row)." };
  if (typeof validFrom !== "number" || typeof validTo !== "number") {
    return { ok: false, message: "validFrom and validTo are required to resolve a placeholder." };
  }
  if (validTo <= validFrom) return { ok: false, message: "validTo must be after validFrom." };

  const now = Math.floor(Date.now() / 1000);

  const existingUser = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (existingUser && existingUser.role !== "talent") {
    return { ok: false, message: `${email} is an existing ${existingUser.role} account — not eligible as cast talent.` };
  }

  if (existingUser) {
    // Existing talent → create a placeholder licence and link the cast row.
    const licenceId = crypto.randomUUID();
    await db.insert(licences).values({
      id: licenceId,
      talentId: existingUser.id,
      licenseeId: opts.actorUserId,
      projectName: production.name,
      productionCompany: production.company,
      intendedUse,
      validFrom,
      validTo,
      status: "AWAITING_PACKAGE",
      licenceType,
      territory,
      exclusivity,
      permitAiTraining,
      proposedFee,
      productionId: opts.productionId,
      createdAt: now,
    });
    await mintLicenceCode(db, licenceId);

    await db.update(productionCast).set({
      talentId: existingUser.id,
      licenceId,
      status: "linked",
      licenceTermsJson: null,
      linkedAt: now,
    }).where(eq(productionCast.id, opts.castId));

    const { subject, html } = productionCastLinkedEmail({
      recipientEmail: email,
      productionName: production.name,
      companyName: production.company,
      coordinatorEmail: opts.actorEmail,
      characterName: cast.characterName ?? undefined,
      intendedUse,
      proposedFee: proposedFee ?? undefined,
      reviewUrl: `${opts.baseUrl}/licences/${licenceId}`,
    });
    await sendEmail({ to: email, subject, html }).catch(() => {});

    return { ok: true, status: "linked", licenceId, message: `Linked ${email} to "${production.name}" (licence ${licenceId}).` };
  }

  // Unknown email → 7-day talent invite, terms stored for when they register.
  const pendingInvite = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(
      eq(invites.email, email),
      eq(invites.productionId, opts.productionId),
      isNull(invites.usedAt),
      gt(invites.expiresAt, now),
    ))
    .get();
  if (pendingInvite) {
    return { ok: false, message: `${email} already has a pending invite for this production.` };
  }

  const inviteId = crypto.randomUUID();
  const expiresAt = now + SEVEN_DAYS;
  const licenceTerms = {
    intendedUse, validFrom, validTo, licenceType, territory, exclusivity, permitAiTraining, proposedFee,
    projectName: production.name, productionCompany: production.company,
  };

  await db.insert(invites).values({
    id: inviteId,
    email,
    role: "talent",
    invitedBy: opts.actorUserId,
    talentId: null,
    message: `You've been invited to join the cast of ${production.name}.`,
    usedAt: null,
    expiresAt,
    createdAt: now,
    productionId: opts.productionId,
  });

  await db.update(productionCast).set({
    inviteId,
    status: "invited",
    licenceTermsJson: JSON.stringify(licenceTerms),
  }).where(eq(productionCast.id, opts.castId));

  const { subject, html } = productionCastInviteEmail({
    recipientEmail: email,
    productionName: production.name,
    companyName: production.company,
    coordinatorEmail: opts.actorEmail,
    characterName: cast.characterName ?? undefined,
    intendedUse,
    validFrom,
    validTo,
    signupUrl: `${opts.baseUrl}/signup?invite=${inviteId}`,
  });
  await sendEmail({ to: email, subject, html }).catch(() => {});

  return { ok: true, status: "invited", inviteId, message: `Invited ${email} to "${production.name}" (expires in 7 days).` };
}
