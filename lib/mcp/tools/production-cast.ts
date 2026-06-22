/**
 * Production cast tools.
 *
 * list_productions (read)      — find/confirm a productionId.
 * list_production_cast (read)  — enumerate a production's cast incl. placeholders + castIds.
 * add_production_cast (mutating) — bulk-onboard a cast. Each member is either
 *   contactable (email) or a placeholder (actorName only, recorded for later).
 * resolve_cast_member (mutating) — attach an email to a placeholder and promote
 *   it to an invite/linked licence.
 *
 * Intended flow: create_production ("The Matrix 5") → the agent sources the cast
 * from public sources → add_production_cast (placeholders where no email is known)
 * → later, resolve_cast_member as emails surface.
 *
 * add_production_cast / resolve_cast_member are mutating: the dispatcher gates
 * them behind admin scope + a fresh per-call TOTP code and audits every call.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { registerMcpTool } from "../registry";
import {
  users,
  invites,
  licences,
  productions,
  productionCast,
} from "@/lib/db/schema";
import { eq, and, isNull, gt, sql, desc, like } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import {
  productionCastInviteEmail,
  productionCastLinkedEmail,
} from "@/lib/email/templates";
import {
  promoteCastMember,
  CAST_LICENCE_TYPES as LICENCE_TYPES,
  CAST_EXCLUSIVITIES as EXCLUSIVITIES,
  type CastLicenceType,
  type CastExclusivity,
} from "@/lib/productions/cast";
import type { McpToolContext } from "../types";
import { mintLicenceCode } from "@/lib/codes/codes";

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const MAX_CAST_PER_CALL = 100;

function getBaseUrl(): string {
  try {
    const { env } = getCloudflareContext();
    const e = env as unknown as Record<string, string | undefined>;
    return e.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
  } catch {
    return process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
  }
}

/** Parse a YYYY-MM-DD date into unix seconds (UTC midnight). */
function parseDate(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const ts = Date.parse(value.trim() + "T00:00:00Z");
  return Number.isNaN(ts) ? null : Math.floor(ts / 1000);
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, 1), max);
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Company name displayed in cast emails: prefer the production's organisation,
// fall back to its production company, else a generic label.
const companyNameSql = sql<string>`coalesce(
  (SELECT name FROM organisations WHERE id = ${productions.organisationId}),
  (SELECT name FROM production_companies WHERE id = ${productions.companyId}),
  'Production Company'
)`;

registerMcpTool({
  name: "list_productions",
  description:
    "List productions with their company, type, year, status and current cast size. " +
    "Use this to find the productionId to pass to add_production_cast.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Case-insensitive substring filter on production title" },
      limit: { type: "number", description: "Max rows (default 50, max 200)" },
    },
  },
  mutating: false,
  async execute({ db }, params) {
    const search = trimmed(params.search);
    const rows = await db
      .select({
        id: productions.id,
        name: productions.name,
        company: companyNameSql,
        type: productions.type,
        year: productions.year,
        status: productions.status,
        director: productions.director,
        castCount: sql<number>`(SELECT count(*) FROM production_cast WHERE production_id = ${productions.id})`,
        createdAt: productions.createdAt,
      })
      .from(productions)
      .where(search ? like(productions.name, `%${search}%`) : undefined)
      .orderBy(desc(productions.createdAt))
      .limit(clampLimit(params.limit, 50, 200))
      .all();
    return { success: true, message: `${rows.length} production(s).`, data: { productions: rows } };
  },
});

registerMcpTool({
  name: "list_production_cast",
  description:
    "List a production's cast, including placeholder rows that still need an email. " +
    "Returns each row's castId, identity, character, status and tmdbId — use the castId with " +
    "resolve_cast_member to attach an email to a placeholder.",
  inputSchema: {
    type: "object",
    properties: {
      productionId: { type: "string", description: "Production UUID" },
    },
    required: ["productionId"],
  },
  mutating: false,
  async execute({ db }, params) {
    const productionId = trimmed(params.productionId);
    if (!productionId) return { success: false, message: "productionId is required." };

    const production = await db
      .select({ id: productions.id, name: productions.name })
      .from(productions)
      .where(eq(productions.id, productionId))
      .get();
    if (!production) return { success: false, message: `No production with id ${productionId}.` };

    const rows = await db
      .select({
        castId: productionCast.id,
        name: sql<string>`coalesce(
          ${productionCast.actorName},
          (SELECT full_name FROM talent_profiles WHERE user_id = ${productionCast.talentId}),
          (SELECT email FROM invites WHERE id = ${productionCast.inviteId}),
          '—'
        )`,
        characterName: productionCast.characterName,
        department: productionCast.department,
        sagMember: productionCast.sagMember,
        status: productionCast.status,
        tmdbId: productionCast.tmdbId,
        addedAt: productionCast.addedAt,
      })
      .from(productionCast)
      .where(eq(productionCast.productionId, productionId))
      .orderBy(desc(productionCast.addedAt))
      .all();

    const placeholders = rows.filter((r) => r.status === "placeholder").length;
    return {
      success: true,
      message: `${rows.length} cast member(s) on "${production.name}" (${placeholders} placeholder${placeholders === 1 ? "" : "s"}).`,
      data: { productionId, cast: rows },
    };
  },
});

interface CallDefaults {
  intendedUse: string;
  validFrom: number | null;
  validTo: number | null;
  licenceType: CastLicenceType | null;
  territory: string | null;
  exclusivity: CastExclusivity;
  permitAiTraining: boolean;
}

interface ResolvedMember {
  mode: "email" | "placeholder";
  email: string | null;
  actorName: string | null;
  tmdbId: number | null;
  sourceNote: string | null;
  characterName: string | null;
  department: string | null;
  sagMember: boolean;
  intendedUse: string;
  validFrom: number | null;
  validTo: number | null;
  licenceType: CastLicenceType | null;
  territory: string | null;
  exclusivity: CastExclusivity;
  permitAiTraining: boolean;
  proposedFee: number | null;
}

/** Resolve one raw member against the call-level defaults, or return an error string. */
function resolveMember(raw: Record<string, unknown>, defaults: CallDefaults): ResolvedMember | string {
  const email = trimmed(raw.email).toLowerCase();
  const actorName = trimmed(raw.actorName);
  if (!email && !actorName) return "Each member needs an email or an actorName.";
  if (email && !email.includes("@")) return `"${trimmed(raw.email)}" is not a valid email.`;

  const intendedUse = trimmed(raw.intendedUse) || defaults.intendedUse;

  // Dates: an explicitly supplied bad date is an error in either mode.
  let validFrom = defaults.validFrom;
  if (raw.validFrom !== undefined) {
    validFrom = parseDate(raw.validFrom);
    if (validFrom === null) return `${email || actorName}: validFrom must be YYYY-MM-DD.`;
  }
  let validTo = defaults.validTo;
  if (raw.validTo !== undefined) {
    validTo = parseDate(raw.validTo);
    if (validTo === null) return `${email || actorName}: validTo must be YYYY-MM-DD.`;
  }
  if (validFrom !== null && validTo !== null && validTo <= validFrom) {
    return `${email || actorName}: validTo must be after validFrom.`;
  }

  const mode: "email" | "placeholder" = email ? "email" : "placeholder";

  // A contactable member is onboarded immediately, so full terms are required.
  if (mode === "email") {
    if (!intendedUse) return `${email}: intendedUse is required (per-member or as a call default).`;
    if (validFrom === null || validTo === null) {
      return `${email}: validFrom and validTo (YYYY-MM-DD) are required (per-member or as a call default).`;
    }
  }

  const licenceTypeRaw = raw.licenceType !== undefined ? raw.licenceType : defaults.licenceType;
  const licenceType = LICENCE_TYPES.includes(licenceTypeRaw as CastLicenceType) ? (licenceTypeRaw as CastLicenceType) : null;

  const exclusivityRaw = raw.exclusivity !== undefined ? raw.exclusivity : defaults.exclusivity;
  const exclusivity = EXCLUSIVITIES.includes(exclusivityRaw as CastExclusivity) ? (exclusivityRaw as CastExclusivity) : "non_exclusive";

  const proposedFee = typeof raw.proposedFeeCents === "number" && raw.proposedFeeCents > 0 ? Math.floor(raw.proposedFeeCents) : null;
  const tmdbId = typeof raw.tmdbId === "number" && Number.isFinite(raw.tmdbId) ? Math.floor(raw.tmdbId) : null;

  return {
    mode,
    email: email || null,
    actorName: actorName || null,
    tmdbId,
    sourceNote: trimmed(raw.sourceNote) || null,
    characterName: trimmed(raw.characterName) || null,
    department: trimmed(raw.department) || null,
    sagMember: raw.sagMember === true,
    intendedUse,
    validFrom,
    validTo,
    licenceType,
    territory: trimmed(raw.territory) || defaults.territory,
    exclusivity,
    permitAiTraining: raw.permitAiTraining !== undefined ? raw.permitAiTraining === true : defaults.permitAiTraining,
    proposedFee,
  };
}

/** Stored licence-terms blob carried on a row until a licence is created. */
function termsBlob(m: ResolvedMember, production: { name: string; company: string }) {
  return {
    intendedUse: m.intendedUse || undefined,
    validFrom: m.validFrom ?? undefined,
    validTo: m.validTo ?? undefined,
    licenceType: m.licenceType,
    territory: m.territory,
    exclusivity: m.exclusivity,
    permitAiTraining: m.permitAiTraining,
    proposedFee: m.proposedFee,
    projectName: production.name,
    productionCompany: production.company,
  };
}

registerMcpTool({
  name: "add_production_cast",
  description:
    "Bulk-add cast members to a production (find the productionId via list_productions or create_production). " +
    "Each member is either CONTACTABLE (give an email — onboarded now: existing talent get a placeholder " +
    "AWAITING_PACKAGE licence + request email, unknown emails get a 7-day talent invite) or a PLACEHOLDER " +
    "(give actorName with no email — recorded by name only, no email sent, resolve later with resolve_cast_member). " +
    "Set intendedUse / validFrom / validTo / licenceType / territory / exclusivity / permitAiTraining once at the " +
    "top level as defaults, or override per member; contactable members require intendedUse + validFrom + validTo, " +
    "placeholders don't. Skips members already cast, with a pending invite, or duplicate placeholders (by tmdbId, " +
    "else by name). Up to " + MAX_CAST_PER_CALL + " members per call.",
  inputSchema: {
    type: "object",
    properties: {
      productionId: { type: "string", description: "Production UUID (from list_productions / create_production)" },
      intendedUse: { type: "string", description: "Default intended use applied to members that don't set their own" },
      validFrom: { type: "string", description: "Default licence start date, YYYY-MM-DD" },
      validTo: { type: "string", description: "Default licence end date, YYYY-MM-DD" },
      licenceType: { type: "string", enum: [...LICENCE_TYPES], description: "Default licence type" },
      territory: { type: "string", description: "Default territory (e.g. 'Worldwide')" },
      exclusivity: { type: "string", enum: [...EXCLUSIVITIES], description: "Default exclusivity (default non_exclusive)" },
      permitAiTraining: { type: "boolean", description: "Default: whether the licence permits AI training (default false)" },
      members: {
        type: "array",
        description: "Cast members. Each: { email OR actorName, characterName, department, sagMember, tmdbId, " +
          "sourceNote, and optional term overrides: intendedUse, validFrom, validTo, licenceType, territory, " +
          "exclusivity, permitAiTraining, proposedFeeCents }.",
        items: {
          type: "object",
          properties: {
            email: { type: "string", description: "Actor's email — makes the member contactable and onboards them now" },
            actorName: { type: "string", description: "Public name — use when no email is known yet (creates a placeholder)" },
            tmdbId: { type: "number", description: "TMDB person id (optional — used to dedupe and enrich later)" },
            sourceNote: { type: "string", description: "Where the name was sourced (optional provenance)" },
            characterName: { type: "string", description: "Role the actor plays" },
            department: { type: "string", description: "e.g. 'Lead', 'Supporting', 'Stunt'" },
            sagMember: { type: "boolean", description: "Whether the actor is a SAG-AFTRA member" },
            intendedUse: { type: "string", description: "Override the call-level intendedUse" },
            validFrom: { type: "string", description: "Override start date, YYYY-MM-DD" },
            validTo: { type: "string", description: "Override end date, YYYY-MM-DD" },
            licenceType: { type: "string", enum: [...LICENCE_TYPES], description: "Override licence type" },
            territory: { type: "string", description: "Override territory" },
            exclusivity: { type: "string", enum: [...EXCLUSIVITIES], description: "Override exclusivity" },
            permitAiTraining: { type: "boolean", description: "Override AI-training permission" },
            proposedFeeCents: { type: "number", description: "Proposed fee for this member, in cents" },
          },
        },
      },
    },
    required: ["productionId", "members"],
  },
  mutating: true,
  async execute(ctx: McpToolContext, params) {
    const { db, token } = ctx;

    const productionId = trimmed(params.productionId);
    if (!productionId) return { success: false, message: "productionId is required." };

    if (!Array.isArray(params.members) || params.members.length === 0) {
      return { success: false, message: "members must be a non-empty array." };
    }
    if (params.members.length > MAX_CAST_PER_CALL) {
      return { success: false, message: `Too many members (${params.members.length}); max ${MAX_CAST_PER_CALL} per call.` };
    }

    const production = await db
      .select({ id: productions.id, name: productions.name, company: companyNameSql })
      .from(productions)
      .where(eq(productions.id, productionId))
      .get();
    if (!production) return { success: false, message: `No production with id ${productionId}.` };

    const defaults: CallDefaults = {
      intendedUse: trimmed(params.intendedUse),
      validFrom: params.validFrom !== undefined ? parseDate(params.validFrom) : null,
      validTo: params.validTo !== undefined ? parseDate(params.validTo) : null,
      licenceType: LICENCE_TYPES.includes(params.licenceType as CastLicenceType) ? (params.licenceType as CastLicenceType) : null,
      territory: trimmed(params.territory) || null,
      exclusivity: EXCLUSIVITIES.includes(params.exclusivity as CastExclusivity) ? (params.exclusivity as CastExclusivity) : "non_exclusive",
      permitAiTraining: params.permitAiTraining === true,
    };

    const coordinatorEmail = token.email;
    const baseUrl = getBaseUrl();
    const now = Math.floor(Date.now() / 1000);

    let linked = 0;
    let invited = 0;
    let placeholders = 0;
    const skipped: string[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const rawMember of params.members) {
      if (typeof rawMember !== "object" || rawMember === null) {
        errors.push("A member entry was not an object.");
        continue;
      }
      const resolved = resolveMember(rawMember as Record<string, unknown>, defaults);
      if (typeof resolved === "string") {
        errors.push(resolved);
        continue;
      }
      const member = resolved;

      // Within-call dedupe key (email, tmdb id, or name).
      const dedupeKey = member.email
        ? `email:${member.email}`
        : member.tmdbId != null
          ? `tmdb:${member.tmdbId}`
          : `name:${(member.actorName ?? "").toLowerCase()}`;
      if (seen.has(dedupeKey)) {
        skipped.push(`${member.email ?? member.actorName}: listed more than once in this call.`);
        continue;
      }
      seen.add(dedupeKey);

      try {
        if (member.mode === "placeholder") {
          // Dedupe against existing placeholder/cast rows on this production.
          const dupe = await db
            .select({ id: productionCast.id })
            .from(productionCast)
            .where(and(
              eq(productionCast.productionId, productionId),
              member.tmdbId != null
                ? eq(productionCast.tmdbId, member.tmdbId)
                : sql`lower(${productionCast.actorName}) = ${(member.actorName ?? "").toLowerCase()}`,
            ))
            .get();
          if (dupe) {
            skipped.push(`${member.actorName}: already on this production.`);
            continue;
          }

          await db.insert(productionCast).values({
            id: crypto.randomUUID(),
            productionId,
            talentId: null,
            inviteId: null,
            licenceId: null,
            actorName: member.actorName,
            tmdbId: member.tmdbId,
            sourceNote: member.sourceNote,
            characterName: member.characterName,
            department: member.department,
            sagMember: member.sagMember,
            status: "placeholder",
            licenceTermsJson: JSON.stringify(termsBlob(member, production)),
            addedBy: token.userId,
            addedAt: now,
            linkedAt: null,
          });
          placeholders++;
          continue;
        }

        // Contactable member (has an email).
        const email = member.email as string;
        const existingUser = await db
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(eq(users.email, email))
          .get();

        if (existingUser && existingUser.role === "talent") {
          const alreadyCast = await db
            .select({ id: productionCast.id })
            .from(productionCast)
            .where(and(eq(productionCast.productionId, productionId), eq(productionCast.talentId, existingUser.id)))
            .get();
          if (alreadyCast) {
            skipped.push(`${email}: already cast on this production.`);
            continue;
          }

          const licenceId = crypto.randomUUID();
          await db.insert(licences).values({
            id: licenceId,
            talentId: existingUser.id,
            licenseeId: token.userId,
            projectName: production.name,
            productionCompany: production.company,
            intendedUse: member.intendedUse,
            validFrom: member.validFrom!,
            validTo: member.validTo!,
            status: "AWAITING_PACKAGE",
            licenceType: member.licenceType,
            territory: member.territory,
            exclusivity: member.exclusivity,
            permitAiTraining: member.permitAiTraining,
            proposedFee: member.proposedFee,
            productionId,
            createdAt: now,
          });
          await mintLicenceCode(db, licenceId);

          await db.insert(productionCast).values({
            id: crypto.randomUUID(),
            productionId,
            talentId: existingUser.id,
            inviteId: null,
            licenceId,
            actorName: member.actorName,
            tmdbId: member.tmdbId,
            sourceNote: member.sourceNote,
            characterName: member.characterName,
            department: member.department,
            sagMember: member.sagMember,
            status: "linked",
            licenceTermsJson: null,
            addedBy: token.userId,
            addedAt: now,
            linkedAt: now,
          });

          const { subject, html } = productionCastLinkedEmail({
            recipientEmail: email,
            productionName: production.name,
            companyName: production.company,
            coordinatorEmail,
            characterName: member.characterName ?? undefined,
            intendedUse: member.intendedUse,
            proposedFee: member.proposedFee ?? undefined,
            reviewUrl: `${baseUrl}/licences/${licenceId}`,
          });
          await sendEmail({ to: email, subject, html }).catch(() => {});

          linked++;
        } else if (existingUser) {
          skipped.push(`${email}: existing ${existingUser.role} account — not eligible as cast talent.`);
        } else {
          const pendingInvite = await db
            .select({ id: invites.id })
            .from(invites)
            .where(and(
              eq(invites.email, email),
              eq(invites.productionId, productionId),
              isNull(invites.usedAt),
              gt(invites.expiresAt, now),
            ))
            .get();
          if (pendingInvite) {
            skipped.push(`${email}: already has a pending invite for this production.`);
            continue;
          }

          const inviteId = crypto.randomUUID();
          const expiresAt = now + SEVEN_DAYS;

          await db.insert(invites).values({
            id: inviteId,
            email,
            role: "talent",
            invitedBy: token.userId,
            talentId: null,
            message: `You've been invited to join the cast of ${production.name}.`,
            usedAt: null,
            expiresAt,
            createdAt: now,
            productionId,
          });

          await db.insert(productionCast).values({
            id: crypto.randomUUID(),
            productionId,
            talentId: null,
            inviteId,
            licenceId: null,
            actorName: member.actorName,
            tmdbId: member.tmdbId,
            sourceNote: member.sourceNote,
            characterName: member.characterName,
            department: member.department,
            sagMember: member.sagMember,
            status: "invited",
            licenceTermsJson: JSON.stringify(termsBlob(member, production)),
            addedBy: token.userId,
            addedAt: now,
            linkedAt: null,
          });

          const { subject, html } = productionCastInviteEmail({
            recipientEmail: email,
            productionName: production.name,
            companyName: production.company,
            coordinatorEmail,
            characterName: member.characterName ?? undefined,
            intendedUse: member.intendedUse,
            validFrom: member.validFrom!,
            validTo: member.validTo!,
            signupUrl: `${baseUrl}/signup?invite=${inviteId}`,
          });
          await sendEmail({ to: email, subject, html }).catch(() => {});

          invited++;
        }
      } catch (err) {
        errors.push(`${member.email ?? member.actorName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const added = linked + invited + placeholders;
    const parts = [`${added} added to "${production.name}" (${linked} linked, ${invited} invited, ${placeholders} placeholder)`];
    if (skipped.length) parts.push(`${skipped.length} skipped`);
    if (errors.length) parts.push(`${errors.length} error(s)`);

    return {
      success: errors.length === 0,
      message: parts.join(", ") + ".",
      data: { productionId, added, linked, invited, placeholders, skipped, errors },
    };
  },
});

registerMcpTool({
  name: "resolve_cast_member",
  description:
    "Attach an email to a placeholder cast member and onboard them: existing talent get a placeholder " +
    "AWAITING_PACKAGE licence + request email; an unknown email gets a 7-day talent signup invite. Find the " +
    "castId via list_production_cast. Terms come from what was stored on the placeholder; supply intendedUse / " +
    "validFrom / validTo (and optionally licenceType / territory / exclusivity / permitAiTraining / proposedFeeCents) " +
    "to fill or override them — they're required if the placeholder didn't already carry them.",
  inputSchema: {
    type: "object",
    properties: {
      productionId: { type: "string", description: "Production UUID" },
      castId: { type: "string", description: "Cast row UUID (from list_production_cast)" },
      email: { type: "string", description: "Email to onboard this cast member with" },
      intendedUse: { type: "string", description: "Intended use (overrides/fills stored terms)" },
      validFrom: { type: "string", description: "Licence start date, YYYY-MM-DD" },
      validTo: { type: "string", description: "Licence end date, YYYY-MM-DD" },
      licenceType: { type: "string", enum: [...LICENCE_TYPES], description: "Licence type" },
      territory: { type: "string", description: "Territory" },
      exclusivity: { type: "string", enum: [...EXCLUSIVITIES], description: "Exclusivity" },
      permitAiTraining: { type: "boolean", description: "Whether the licence permits AI training" },
      proposedFeeCents: { type: "number", description: "Proposed fee in cents" },
    },
    required: ["productionId", "castId", "email"],
  },
  mutating: true,
  async execute({ db, token }, params) {
    const productionId = trimmed(params.productionId);
    const castId = trimmed(params.castId);
    const email = trimmed(params.email);
    if (!productionId || !castId || !email) {
      return { success: false, message: "productionId, castId and email are required." };
    }

    // Build overrides only from supplied fields. Invalid dates are reported here.
    const overrides: Parameters<typeof promoteCastMember>[1]["overrides"] = {};
    if (params.intendedUse !== undefined) overrides.intendedUse = trimmed(params.intendedUse);
    if (params.validFrom !== undefined) {
      const v = parseDate(params.validFrom);
      if (v === null) return { success: false, message: "validFrom must be YYYY-MM-DD." };
      overrides.validFrom = v;
    }
    if (params.validTo !== undefined) {
      const v = parseDate(params.validTo);
      if (v === null) return { success: false, message: "validTo must be YYYY-MM-DD." };
      overrides.validTo = v;
    }
    if (params.licenceType !== undefined) overrides.licenceType = params.licenceType as CastLicenceType;
    if (params.territory !== undefined) overrides.territory = trimmed(params.territory) || null;
    if (params.exclusivity !== undefined) overrides.exclusivity = params.exclusivity as CastExclusivity;
    if (params.permitAiTraining !== undefined) overrides.permitAiTraining = params.permitAiTraining === true;
    if (typeof params.proposedFeeCents === "number" && params.proposedFeeCents > 0) {
      overrides.proposedFee = Math.floor(params.proposedFeeCents);
    }

    const result = await promoteCastMember(db, {
      productionId,
      castId,
      email,
      actorUserId: token.userId,
      actorEmail: token.email,
      baseUrl: getBaseUrl(),
      overrides,
    });

    return {
      success: result.ok,
      message: result.message,
      data: result.ok ? { castId, status: result.status, licenceId: result.licenceId, inviteId: result.inviteId } : undefined,
    };
  },
});
