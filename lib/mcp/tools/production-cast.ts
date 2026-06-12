/**
 * Production cast tools.
 *
 * list_productions (read) lets an agent find/confirm production IDs.
 * add_production_cast (mutating) bulk-onboards a cast onto a production —
 * the MCP analogue of POST /api/productions/[id]/cast. The intended flow is:
 *   1. create_production (e.g. "The Matrix 5")
 *   2. the agent sources the cast from public web sources (its own research)
 *   3. add_production_cast persists the whole cast in one call
 *
 * For each member: if the email already belongs to a talent account a
 * placeholder licence (AWAITING_PACKAGE) + linked cast row are created and the
 * talent is emailed; otherwise a 7-day talent signup invite + an "invited" cast
 * row (with the licence terms stored for later) are created and the invite is
 * emailed. Identical writes/emails to the in-app bulk-add flow.
 */

import { getRequestContext } from "@cloudflare/next-on-pages";
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
import type { McpToolContext } from "../types";

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const MAX_CAST_PER_CALL = 100;

const LICENCE_TYPES = ["film_double", "game_character", "commercial", "ai_avatar", "training_data", "monitoring_reference"] as const;
const EXCLUSIVITIES = ["non_exclusive", "sole", "exclusive"] as const;

function getBaseUrl(): string {
  try {
    const { env } = getRequestContext();
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

interface ResolvedMember {
  email: string;
  characterName: string | null;
  department: string | null;
  sagMember: boolean;
  intendedUse: string;
  validFrom: number;
  validTo: number;
  licenceType: (typeof LICENCE_TYPES)[number] | null;
  territory: string | null;
  exclusivity: (typeof EXCLUSIVITIES)[number];
  permitAiTraining: boolean;
  proposedFee: number | null; // cents
}

/** Resolve one raw member against the call-level defaults, or return an error string. */
function resolveMember(
  raw: Record<string, unknown>,
  defaults: {
    intendedUse: string;
    validFrom: number | null;
    validTo: number | null;
    licenceType: (typeof LICENCE_TYPES)[number] | null;
    territory: string | null;
    exclusivity: (typeof EXCLUSIVITIES)[number];
    permitAiTraining: boolean;
  }
): ResolvedMember | string {
  const email = trimmed(raw.email).toLowerCase();
  if (!email || !email.includes("@")) return `"${trimmed(raw.email) || "(blank)"}" is not a valid email.`;

  const intendedUse = trimmed(raw.intendedUse) || defaults.intendedUse;
  if (!intendedUse) return `${email}: intendedUse is required (set it per-member or as a call default).`;

  const validFrom = raw.validFrom !== undefined ? parseDate(raw.validFrom) : defaults.validFrom;
  const validTo = raw.validTo !== undefined ? parseDate(raw.validTo) : defaults.validTo;
  if (validFrom === null || validTo === null) {
    return `${email}: validFrom and validTo are required as YYYY-MM-DD (per-member or as a call default).`;
  }
  if (validTo <= validFrom) return `${email}: validTo must be after validFrom.`;

  const licenceTypeRaw = raw.licenceType !== undefined ? raw.licenceType : defaults.licenceType;
  const licenceType = LICENCE_TYPES.includes(licenceTypeRaw as (typeof LICENCE_TYPES)[number])
    ? (licenceTypeRaw as (typeof LICENCE_TYPES)[number]) : null;

  const exclusivityRaw = raw.exclusivity !== undefined ? raw.exclusivity : defaults.exclusivity;
  const exclusivity = EXCLUSIVITIES.includes(exclusivityRaw as (typeof EXCLUSIVITIES)[number])
    ? (exclusivityRaw as (typeof EXCLUSIVITIES)[number]) : "non_exclusive";

  const proposedFee = typeof raw.proposedFeeCents === "number" && raw.proposedFeeCents > 0
    ? Math.floor(raw.proposedFeeCents) : null;

  return {
    email,
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

registerMcpTool({
  name: "add_production_cast",
  description:
    "Bulk-add cast members to a production (find the productionId via list_productions or create_production). " +
    "Source the cast from public sources, then pass one members array — each needs an email so the actor can be " +
    "onboarded. For each member: existing talent accounts get a placeholder licence (AWAITING_PACKAGE) and are " +
    "emailed a request; everyone else gets a 7-day talent signup invite with the licence terms stored for when " +
    "they register. Set intendedUse / validFrom / validTo / licenceType / territory / exclusivity / permitAiTraining " +
    "once at the top level as defaults for every member, or override them per member. Members already cast on this " +
    "production (or with a pending invite) are skipped. Up to " + MAX_CAST_PER_CALL + " members per call.",
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
        description: "Cast members to add. Each: { email (required), characterName, department, sagMember, " +
          "and optional overrides: intendedUse, validFrom, validTo, licenceType, territory, exclusivity, " +
          "permitAiTraining, proposedFeeCents }.",
        items: {
          type: "object",
          properties: {
            email: { type: "string", description: "Actor's email (required — used to onboard/invite them)" },
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
          required: ["email"],
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

    // Load the production + a display company name for the cast emails.
    const production = await db
      .select({ id: productions.id, name: productions.name, company: companyNameSql })
      .from(productions)
      .where(eq(productions.id, productionId))
      .get();
    if (!production) return { success: false, message: `No production with id ${productionId}.` };

    const defaults = {
      intendedUse: trimmed(params.intendedUse),
      validFrom: params.validFrom !== undefined ? parseDate(params.validFrom) : null,
      validTo: params.validTo !== undefined ? parseDate(params.validTo) : null,
      licenceType: LICENCE_TYPES.includes(params.licenceType as (typeof LICENCE_TYPES)[number])
        ? (params.licenceType as (typeof LICENCE_TYPES)[number]) : null,
      territory: trimmed(params.territory) || null,
      exclusivity: EXCLUSIVITIES.includes(params.exclusivity as (typeof EXCLUSIVITIES)[number])
        ? (params.exclusivity as (typeof EXCLUSIVITIES)[number]) : ("non_exclusive" as const),
      permitAiTraining: params.permitAiTraining === true,
    };

    const coordinatorEmail = token.email;
    const baseUrl = getBaseUrl();
    const now = Math.floor(Date.now() / 1000);

    let linked = 0;
    let invited = 0;
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

      // Skip duplicates within this same call.
      if (seen.has(member.email)) {
        skipped.push(`${member.email}: listed more than once in this call.`);
        continue;
      }
      seen.add(member.email);

      try {
        const existingUser = await db
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(eq(users.email, member.email))
          .get();

        if (existingUser && existingUser.role === "talent") {
          // Guard against re-adding the same talent to this production.
          const alreadyCast = await db
            .select({ id: productionCast.id })
            .from(productionCast)
            .where(and(eq(productionCast.productionId, productionId), eq(productionCast.talentId, existingUser.id)))
            .get();
          if (alreadyCast) {
            skipped.push(`${member.email}: already cast on this production.`);
            continue;
          }

          const licenceId = crypto.randomUUID();
          const castId = crypto.randomUUID();

          await db.insert(licences).values({
            id: licenceId,
            talentId: existingUser.id,
            licenseeId: token.userId,
            projectName: production.name,
            productionCompany: production.company,
            intendedUse: member.intendedUse,
            validFrom: member.validFrom,
            validTo: member.validTo,
            status: "AWAITING_PACKAGE",
            licenceType: member.licenceType,
            territory: member.territory,
            exclusivity: member.exclusivity,
            permitAiTraining: member.permitAiTraining,
            proposedFee: member.proposedFee,
            productionId,
            createdAt: now,
          });

          await db.insert(productionCast).values({
            id: castId,
            productionId,
            talentId: existingUser.id,
            inviteId: null,
            licenceId,
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
            recipientEmail: member.email,
            productionName: production.name,
            companyName: production.company,
            coordinatorEmail,
            characterName: member.characterName ?? undefined,
            intendedUse: member.intendedUse,
            proposedFee: member.proposedFee ?? undefined,
            reviewUrl: `${baseUrl}/licences/${licenceId}`,
          });
          await sendEmail({ to: member.email, subject, html }).catch(() => {});

          linked++;
        } else if (existingUser) {
          // An existing non-talent account (licensee/rep/admin) can't be cast as talent.
          skipped.push(`${member.email}: existing ${existingUser.role} account — not eligible as cast talent.`);
        } else {
          // No account — make sure we aren't duplicating a still-open invite.
          const pendingInvite = await db
            .select({ id: invites.id })
            .from(invites)
            .where(and(
              eq(invites.email, member.email),
              eq(invites.productionId, productionId),
              isNull(invites.usedAt),
              gt(invites.expiresAt, now),
            ))
            .get();
          if (pendingInvite) {
            skipped.push(`${member.email}: already has a pending invite for this production.`);
            continue;
          }

          const inviteId = crypto.randomUUID();
          const castId = crypto.randomUUID();
          const expiresAt = now + SEVEN_DAYS;

          const licenceTerms = {
            intendedUse: member.intendedUse,
            validFrom: member.validFrom,
            validTo: member.validTo,
            licenceType: member.licenceType,
            territory: member.territory,
            exclusivity: member.exclusivity,
            permitAiTraining: member.permitAiTraining,
            proposedFee: member.proposedFee,
            projectName: production.name,
            productionCompany: production.company,
          };

          await db.insert(invites).values({
            id: inviteId,
            email: member.email,
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
            id: castId,
            productionId,
            talentId: null,
            inviteId,
            licenceId: null,
            characterName: member.characterName,
            department: member.department,
            sagMember: member.sagMember,
            status: "invited",
            licenceTermsJson: JSON.stringify(licenceTerms),
            addedBy: token.userId,
            addedAt: now,
            linkedAt: null,
          });

          const { subject, html } = productionCastInviteEmail({
            recipientEmail: member.email,
            productionName: production.name,
            companyName: production.company,
            coordinatorEmail,
            characterName: member.characterName ?? undefined,
            intendedUse: member.intendedUse,
            validFrom: member.validFrom,
            validTo: member.validTo,
            signupUrl: `${baseUrl}/signup?invite=${inviteId}`,
          });
          await sendEmail({ to: member.email, subject, html }).catch(() => {});

          invited++;
        }
      } catch (err) {
        errors.push(`${member.email}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const added = linked + invited;
    const parts = [`${added} added to "${production.name}" (${linked} linked, ${invited} invited)`];
    if (skipped.length) parts.push(`${skipped.length} skipped`);
    if (errors.length) parts.push(`${errors.length} error(s)`);

    return {
      success: errors.length === 0,
      message: parts.join(", ") + ".",
      data: { productionId, added, linked, invited, skipped, errors },
    };
  },
});
