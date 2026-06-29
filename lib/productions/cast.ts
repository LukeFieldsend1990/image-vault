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
import {
  reconcileTrainingFlag,
  serializeUseCategoryIds,
  parseUseCategoryIds,
  type UseCategoryId,
} from "@/lib/consent/use-categories";
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
  licenceType?: CastLicenceType | null;          // legacy primary use type (first of licenceTypes)
  licenceTypes?: CastLicenceType[];              // multi-select use types (item 7)
  territory?: string | null;
  exclusivity?: CastExclusivity;
  permitAiTraining?: boolean;
  useCategoryIds?: UseCategoryId[]; // canonical taxonomy ids (lib/consent/use-categories.ts)
  proposedFee?: number | null; // cents; null = N/A (distinct from 0)
  isRelicense?: boolean;        // item 9 — re-licence of an existing scan
}

/** Filter arbitrary input to the valid, de-duplicated set of cast licence types (canonical order). */
export function normaliseLicenceTypes(input: unknown): CastLicenceType[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<CastLicenceType>();
  for (const v of input) if (CAST_LICENCE_TYPES.includes(v as CastLicenceType)) seen.add(v as CastLicenceType);
  return CAST_LICENCE_TYPES.filter((t) => seen.has(t));
}

/** Serialize licence types for a *_types_json text column (null when empty). */
export function serializeLicenceTypes(input: unknown): string | null {
  const ids = normaliseLicenceTypes(input);
  return ids.length ? JSON.stringify(ids) : null;
}

/** Parse a licence_types_json text column back into validated licence types. */
export function parseLicenceTypes(json: string | null | undefined): CastLicenceType[] {
  if (!json) return [];
  try { return normaliseLicenceTypes(JSON.parse(json)); } catch { return []; }
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
      useCategoriesJson: productionDefaultTerms.useCategoriesJson,
      licenceTypesJson: productionDefaultTerms.licenceTypesJson,
      isRelicense: productionDefaultTerms.isRelicense,
      proposedFee: productionDefaultTerms.proposedFee,
    })
    .from(productionDefaultTerms)
    .where(eq(productionDefaultTerms.productionId, productionId))
    .get();
  if (!row) return {};
  const useCategoryIds = parseUseCategoryIds(row.useCategoriesJson);
  const licenceTypes = parseLicenceTypes(row.licenceTypesJson);
  return {
    intendedUse: row.intendedUse ?? undefined,
    validFrom: row.validFrom ?? undefined,
    validTo: row.validTo ?? undefined,
    licenceType: licenceTypes[0] ?? normaliseType(row.licenceType),
    licenceTypes: licenceTypes.length ? licenceTypes : undefined,
    territory: row.territory ?? undefined,
    exclusivity: row.exclusivity ? normaliseExclusivity(row.exclusivity) : undefined,
    permitAiTraining: row.permitAiTraining ?? undefined,
    useCategoryIds: useCategoryIds.length ? useCategoryIds : undefined,
    proposedFee: row.proposedFee ?? undefined,
    isRelicense: row.isRelicense ?? undefined,
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
    repMessage?: string;  // optional personal note from the rep to their client
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
    .select({ id: productions.id, name: productions.name, company: companyNameSql, organisationId: productions.organisationId })
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
  // Multi-select use types (item 7). Primary licenceType is the first of the array
  // (kept for back-compat); the full array is persisted on the licence.
  const licenceTypes = normaliseLicenceTypes(
    (o.licenceTypes && o.licenceTypes.length ? o.licenceTypes : undefined)
    ?? (stored.licenceTypes && stored.licenceTypes.length ? stored.licenceTypes : undefined)
    ?? (d.licenceTypes && d.licenceTypes.length ? d.licenceTypes : undefined)
    ?? [],
  );
  const licenceType = licenceTypes[0] ?? normaliseType(o.licenceType ?? stored.licenceType ?? d.licenceType);
  const licenceTypesJson = serializeLicenceTypes(licenceTypes);
  const isRelicense = o.isRelicense ?? stored.isRelicense ?? d.isRelicense ?? undefined;
  const territory = (o.territory ?? stored.territory ?? d.territory) || null;
  const exclusivity = normaliseExclusivity(o.exclusivity ?? stored.exclusivity ?? d.exclusivity);
  // Reconcile the use-category taxonomy with the legacy permitAiTraining boolean
  // so the two can't drift (selecting `training` implies AI-training permitted).
  const reconciled = reconcileTrainingFlag({
    useCategoryIds: o.useCategoryIds ?? stored.useCategoryIds ?? d.useCategoryIds,
    permitAiTraining: o.permitAiTraining ?? stored.permitAiTraining ?? d.permitAiTraining ?? false,
  });
  const permitAiTraining = reconciled.permitAiTraining;
  const useCategoryIds = reconciled.useCategoryIds;
  const useCategoriesJson = serializeUseCategoryIds(useCategoryIds);
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
      licenceTypesJson,
      isRelicense: isRelicense ?? null,
      territory,
      exclusivity,
      permitAiTraining,
      useCategoriesJson,
      proposedFee,
      productionId: opts.productionId,
      organisationId: production.organisationId,
      createdAt: now,
    });
    await mintLicenceCode(db, licenceId);

    await db.update(productionCast).set({
      talentId: existingUser.id,
      licenceId,
      status: "linked",
      licenceTermsJson: null,
      // Item 11 — talent now linked: clear the production's data-controller attribution.
      dataControllerOrgId: null,
      dataControllerSince: null,
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
      reviewUrl: `${opts.baseUrl}/licences?highlight=${licenceId}`,
      repMessage: opts.repMessage,
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
    intendedUse, validFrom, validTo, licenceType, licenceTypes, territory, exclusivity, permitAiTraining, useCategoryIds, proposedFee, isRelicense,
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
    repMessage: opts.repMessage,
  });
  await sendEmail({ to: email, subject, html }).catch(() => {});

  return { ok: true, status: "invited", inviteId, message: `Invited ${email} to "${production.name}" (expires in 7 days).` };
}
