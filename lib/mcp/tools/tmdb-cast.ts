/**
 * TMDB-backed cast suggestion and bulk population tools.
 *
 * suggest_production_cast (read)    — fetch TMDB credits for a production and
 *   report which actors are already on the platform vs. new.
 *
 * populate_cast_from_tmdb (mutating) — add selected TMDB actors to a production:
 *   registered talent get a linked AWAITING_PACKAGE licence; others become placeholders.
 *
 * outreach_unlinked_cast (mutating) — email rep users asking whether they represent
 *   a placeholder cast member so the connection can be established and an invite sent.
 *
 * Intended flow:
 *   1. suggest_production_cast       → pick actors to add
 *   2. populate_cast_from_tmdb       → adds linked (registered) + placeholder rows
 *   3. outreach_unlinked_cast        → emails reps for the placeholder rows
 *   4. resolve_cast_member           → once a rep confirms, attach email + invite
 */

import { getRequestContext } from "@cloudflare/next-on-pages";
import { registerMcpTool } from "../registry";
import {
  users,
  licences,
  productions,
  productionCast,
  talentProfiles,
  talentReps,
} from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import {
  productionCastLinkedEmail,
  repRepresentationEnquiryEmail,
} from "@/lib/email/templates";
import {
  CAST_LICENCE_TYPES as LICENCE_TYPES,
  CAST_EXCLUSIVITIES as EXCLUSIVITIES,
  type CastLicenceType,
  type CastExclusivity,
} from "@/lib/productions/cast";
import type { McpToolContext } from "../types";

const TMDB_BASE = "https://api.themoviedb.org/3";
const MAX_SUGGEST = 50;
const MAX_POPULATE = 50;
const MAX_OUTREACH_REPS = 30;

function getTmdbKey(): string | null {
  try {
    const { env } = getRequestContext();
    const e = env as unknown as Record<string, string | undefined>;
    return e.TMDB_API_KEY ?? null;
  } catch {
    return process.env.TMDB_API_KEY ?? null;
  }
}

function getBaseUrl(): string {
  try {
    const { env } = getRequestContext();
    const e = env as unknown as Record<string, string | undefined>;
    return e.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
  } catch {
    return process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
  }
}

function parseDate(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const ts = Date.parse(value.trim() + "T00:00:00Z");
  return Number.isNaN(ts) ? null : Math.floor(ts / 1000);
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const companyNameSql = sql<string>`coalesce(
  (SELECT name FROM organisations WHERE id = ${productions.organisationId}),
  (SELECT name FROM production_companies WHERE id = ${productions.companyId}),
  'Production Company'
)`;

interface TmdbCreditRow {
  id: number;
  name: string;
  character: string;
  order: number;
  popularity: number;
}

async function fetchTmdbCredits(
  tmdbId: number,
  prodType: string | null,
): Promise<TmdbCreditRow[] | null> {
  const apiKey = getTmdbKey();
  if (!apiKey) return null;
  const mediaType = prodType === "tv_series" ? "tv" : "movie";
  const res = await fetch(`${TMDB_BASE}/${mediaType}/${tmdbId}/credits?api_key=${apiKey}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json() as { cast?: TmdbCreditRow[] };
  return data.cast ?? [];
}

// ── suggest_production_cast ──────────────────────────────────────────────────

registerMcpTool({
  name: "suggest_production_cast",
  description:
    "Fetch the TMDB cast list for a production and show which actors are already on Image Vault. " +
    "The production must have a tmdbId set (visible in list_productions). " +
    "Each actor is returned with platformStatus: 'registered' (matched by tmdbId in talentProfiles), " +
    "'on_cast' (already added to this production's cast), or 'not_on_platform'. " +
    "Pass selected tmdbPersonIds and names to populate_cast_from_tmdb to bulk-add them.",
  inputSchema: {
    type: "object",
    properties: {
      productionId: { type: "string", description: "Production UUID" },
      limit: {
        type: "number",
        description: `Max cast members to return in billing order (default 20, max ${MAX_SUGGEST})`,
      },
    },
    required: ["productionId"],
  },
  mutating: false,
  async execute({ db }, params) {
    const productionId = trimmed(params.productionId);
    if (!productionId) return { success: false, message: "productionId is required." };

    const production = await db
      .select({
        id: productions.id,
        name: productions.name,
        tmdbId: productions.tmdbId,
        type: productions.type,
      })
      .from(productions)
      .where(eq(productions.id, productionId))
      .get();
    if (!production) return { success: false, message: `No production with id ${productionId}.` };
    if (!production.tmdbId) {
      return {
        success: false,
        message:
          `Production "${production.name}" has no TMDB ID. ` +
          "Set one via the admin panel before using this tool.",
      };
    }
    if (!getTmdbKey()) {
      return { success: false, message: "TMDB_API_KEY is not configured on this environment." };
    }

    const credits = await fetchTmdbCredits(production.tmdbId, production.type);
    if (!credits) {
      return {
        success: false,
        message: `Could not fetch TMDB credits for "${production.name}" (tmdbId: ${production.tmdbId}).`,
      };
    }

    const limit = Math.min(
      Math.max(typeof params.limit === "number" ? Math.floor(params.limit) : 20, 1),
      MAX_SUGGEST,
    );
    const topCast = credits.slice(0, limit);
    if (topCast.length === 0) {
      return {
        success: true,
        message: "No cast found on TMDB for this production.",
        data: { productionId, cast: [] },
      };
    }

    const tmdbIds = topCast.map((c) => c.id);

    const registeredProfiles =
      tmdbIds.length > 0
        ? await db
            .select({ userId: talentProfiles.userId, tmdbId: talentProfiles.tmdbId })
            .from(talentProfiles)
            .where(inArray(talentProfiles.tmdbId, tmdbIds))
            .all()
        : [];
    const registeredByTmdbId = new Map<number, string>();
    for (const p of registeredProfiles) {
      if (p.tmdbId != null) registeredByTmdbId.set(p.tmdbId, p.userId);
    }

    const existingCastRows = await db
      .select({ tmdbId: productionCast.tmdbId, status: productionCast.status, id: productionCast.id })
      .from(productionCast)
      .where(eq(productionCast.productionId, productionId))
      .all();
    const existingByTmdbId = new Map<number, { status: string; castId: string }>();
    for (const row of existingCastRows) {
      if (row.tmdbId != null) existingByTmdbId.set(row.tmdbId, { status: row.status, castId: row.id });
    }

    const cast = topCast.map((member) => {
      const existing = existingByTmdbId.get(member.id);
      const talentId = registeredByTmdbId.get(member.id);
      const platformStatus: "registered" | "on_cast" | "not_on_platform" = existing
        ? "on_cast"
        : talentId
          ? "registered"
          : "not_on_platform";
      return {
        tmdbPersonId: member.id,
        name: member.name,
        character: member.character,
        billingOrder: member.order,
        popularity: member.popularity,
        platformStatus,
        existingCastId: existing?.castId ?? null,
        existingCastStatus: existing?.status ?? null,
        talentId: talentId ?? null,
      };
    });

    const registered = cast.filter((c) => c.platformStatus === "registered").length;
    const onCast = cast.filter((c) => c.platformStatus === "on_cast").length;
    const notOnPlatform = cast.filter((c) => c.platformStatus === "not_on_platform").length;

    return {
      success: true,
      message:
        `${cast.length} cast member(s) from TMDB for "${production.name}": ` +
        `${registered} registered on platform, ${onCast} already on cast, ${notOnPlatform} not on platform.`,
      data: { productionId, productionName: production.name, cast },
    };
  },
});

// ── populate_cast_from_tmdb ──────────────────────────────────────────────────

registerMcpTool({
  name: "populate_cast_from_tmdb",
  description:
    "Add selected TMDB actors to a production's cast. Pass members from suggest_production_cast " +
    "(tmdbPersonId + name, optionally characterName/department/sagMember). " +
    "Registered talent (platformStatus 'registered') get an AWAITING_PACKAGE licence + linked cast row + email. " +
    "Others become placeholder cast rows. Actors already on the cast are skipped. " +
    "Set intendedUse/validFrom/validTo — required for linked (registered) members, stored on placeholders for later. " +
    "Run outreach_unlinked_cast next to email reps about placeholder members.",
  inputSchema: {
    type: "object",
    properties: {
      productionId: { type: "string", description: "Production UUID" },
      intendedUse: {
        type: "string",
        description: "Intended use for the licence (e.g. 'Digital double for VFX sequences')",
      },
      validFrom: { type: "string", description: "Licence start date YYYY-MM-DD" },
      validTo: { type: "string", description: "Licence end date YYYY-MM-DD" },
      licenceType: {
        type: "string",
        enum: [...LICENCE_TYPES],
        description: "Licence type (default: film_double)",
      },
      territory: { type: "string", description: "Territory (e.g. 'Worldwide')" },
      exclusivity: {
        type: "string",
        enum: [...EXCLUSIVITIES],
        description: "Exclusivity (default: non_exclusive)",
      },
      permitAiTraining: {
        type: "boolean",
        description: "Whether the licence permits AI training (default: false)",
      },
      members: {
        type: "array",
        description:
          "Actors to add. Use results from suggest_production_cast (skip those with platformStatus 'on_cast').",
        items: {
          type: "object",
          properties: {
            tmdbPersonId: {
              type: "number",
              description: "TMDB person ID (from suggest_production_cast)",
            },
            name: { type: "string", description: "Actor's full name" },
            characterName: { type: "string", description: "Character they play" },
            department: {
              type: "string",
              description: "e.g. 'Lead', 'Supporting', 'Stunt'",
            },
            sagMember: {
              type: "boolean",
              description: "Whether the actor is a SAG-AFTRA member",
            },
          },
          required: ["tmdbPersonId", "name"],
        },
      },
    },
    required: ["productionId", "members"],
  },
  mutating: true,
  async execute({ db, token }: McpToolContext, params) {
    const productionId = trimmed(params.productionId);
    if (!productionId) return { success: false, message: "productionId is required." };

    if (!Array.isArray(params.members) || params.members.length === 0) {
      return { success: false, message: "members must be a non-empty array." };
    }
    if (params.members.length > MAX_POPULATE) {
      return {
        success: false,
        message: `Too many members (${params.members.length}); max ${MAX_POPULATE} per call.`,
      };
    }

    const production = await db
      .select({ id: productions.id, name: productions.name, company: companyNameSql })
      .from(productions)
      .where(eq(productions.id, productionId))
      .get();
    if (!production) return { success: false, message: `No production with id ${productionId}.` };

    const intendedUse = trimmed(params.intendedUse);
    const validFrom = params.validFrom !== undefined ? parseDate(params.validFrom) : null;
    const validTo = params.validTo !== undefined ? parseDate(params.validTo) : null;
    const licenceType: CastLicenceType | null = LICENCE_TYPES.includes(
      params.licenceType as CastLicenceType,
    )
      ? (params.licenceType as CastLicenceType)
      : null;
    const territory = trimmed(params.territory) || null;
    const exclusivity: CastExclusivity = EXCLUSIVITIES.includes(
      params.exclusivity as CastExclusivity,
    )
      ? (params.exclusivity as CastExclusivity)
      : "non_exclusive";
    const permitAiTraining = params.permitAiTraining === true;

    const baseUrl = getBaseUrl();
    const now = Math.floor(Date.now() / 1000);
    let linked = 0;
    let placeholders = 0;
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const raw of params.members) {
      if (typeof raw !== "object" || raw === null) continue;
      const member = raw as Record<string, unknown>;

      const tmdbPersonId =
        typeof member.tmdbPersonId === "number" ? Math.floor(member.tmdbPersonId) : null;
      const name = trimmed(member.name);
      if (!tmdbPersonId || !name) {
        errors.push("Member is missing tmdbPersonId or name.");
        continue;
      }

      const characterName = trimmed(member.characterName) || null;
      const department = trimmed(member.department) || null;
      const sagMember = member.sagMember === true;

      try {
        const existingRow = await db
          .select({ id: productionCast.id, status: productionCast.status })
          .from(productionCast)
          .where(
            and(
              eq(productionCast.productionId, productionId),
              eq(productionCast.tmdbId, tmdbPersonId),
            ),
          )
          .get();
        if (existingRow) {
          skipped.push(`${name}: already on cast (${existingRow.status}).`);
          continue;
        }

        const profile = await db
          .select({ userId: talentProfiles.userId })
          .from(talentProfiles)
          .where(eq(talentProfiles.tmdbId, tmdbPersonId))
          .get();

        const licenceTermsJson = JSON.stringify({
          intendedUse: intendedUse || undefined,
          validFrom: validFrom ?? undefined,
          validTo: validTo ?? undefined,
          licenceType,
          territory,
          exclusivity,
          permitAiTraining,
          projectName: production.name,
          productionCompany: production.company,
        });

        if (profile) {
          // Registered talent — create licence + linked cast row
          if (!intendedUse || validFrom === null || validTo === null) {
            errors.push(
              `${name}: intendedUse, validFrom, and validTo are required to link a registered talent.`,
            );
            continue;
          }
          if (validTo <= validFrom) {
            errors.push(`${name}: validTo must be after validFrom.`);
            continue;
          }

          const licenceId = crypto.randomUUID();
          await db.insert(licences).values({
            id: licenceId,
            talentId: profile.userId,
            licenseeId: token.userId,
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
            proposedFee: null,
            productionId,
            createdAt: now,
          });

          await db.insert(productionCast).values({
            id: crypto.randomUUID(),
            productionId,
            talentId: profile.userId,
            inviteId: null,
            licenceId,
            actorName: name,
            tmdbId: tmdbPersonId,
            sourceNote: "TMDB cast import",
            characterName,
            department,
            sagMember,
            status: "linked",
            licenceTermsJson: null,
            addedBy: token.userId,
            addedAt: now,
            linkedAt: now,
          });

          const talentUser = await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, profile.userId))
            .get();
          if (talentUser) {
            const { subject, html } = productionCastLinkedEmail({
              recipientEmail: talentUser.email,
              productionName: production.name,
              companyName: production.company,
              coordinatorEmail: token.email,
              characterName: characterName ?? undefined,
              intendedUse,
              reviewUrl: `${baseUrl}/licences/${licenceId}`,
            });
            await sendEmail({ to: talentUser.email, subject, html }).catch(() => {});
          }
          linked++;
        } else {
          // Unknown — placeholder row
          await db.insert(productionCast).values({
            id: crypto.randomUUID(),
            productionId,
            talentId: null,
            inviteId: null,
            licenceId: null,
            actorName: name,
            tmdbId: tmdbPersonId,
            sourceNote: "TMDB cast import",
            characterName,
            department,
            sagMember,
            status: "placeholder",
            licenceTermsJson,
            addedBy: token.userId,
            addedAt: now,
            linkedAt: null,
          });
          placeholders++;
        }
      } catch (err) {
        errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const added = linked + placeholders;
    const parts = [
      `${added} added to "${production.name}" (${linked} linked to registered talent, ${placeholders} placeholder${placeholders !== 1 ? "s" : ""})`,
    ];
    if (skipped.length) parts.push(`${skipped.length} skipped`);
    if (errors.length) parts.push(`${errors.length} error(s)`);

    const hint =
      placeholders > 0
        ? " Use outreach_unlinked_cast to send representation enquiries for the placeholder members."
        : "";

    return {
      success: errors.length === 0,
      message: parts.join(", ") + "." + hint,
      data: { productionId, added, linked, placeholders, skipped, errors },
    };
  },
});

// ── outreach_unlinked_cast ───────────────────────────────────────────────────

registerMcpTool({
  name: "outreach_unlinked_cast",
  description:
    "Send representation enquiry emails to rep users in the system for placeholder cast members, " +
    "asking whether they represent the actor so an invite can be issued. " +
    "For placeholders with a TMDB ID, any reps already linked to a talent with that TMDB ID are " +
    "contacted first; otherwise all rep users in the system receive the enquiry. " +
    "Specify castIds to target specific placeholders; omit to outreach all placeholders on the production. " +
    "After a rep confirms representation, use resolve_cast_member to attach the actor's email and invite them.",
  inputSchema: {
    type: "object",
    properties: {
      productionId: { type: "string", description: "Production UUID" },
      castIds: {
        type: "array",
        description:
          "Specific placeholder cast row UUIDs to outreach for (from list_production_cast). " +
          "Omit to outreach all placeholders on the production.",
        items: { type: "string" },
      },
    },
    required: ["productionId"],
  },
  mutating: true,
  async execute({ db, token }: McpToolContext, params) {
    const productionId = trimmed(params.productionId);
    if (!productionId) return { success: false, message: "productionId is required." };

    const production = await db
      .select({ id: productions.id, name: productions.name, company: companyNameSql })
      .from(productions)
      .where(eq(productions.id, productionId))
      .get();
    if (!production) return { success: false, message: `No production with id ${productionId}.` };

    const allCast = await db
      .select({
        id: productionCast.id,
        actorName: productionCast.actorName,
        tmdbId: productionCast.tmdbId,
        characterName: productionCast.characterName,
        status: productionCast.status,
      })
      .from(productionCast)
      .where(eq(productionCast.productionId, productionId))
      .all();

    const targetIds =
      Array.isArray(params.castIds) && params.castIds.length > 0
        ? new Set(params.castIds as string[])
        : null;

    const placeholderRows = allCast.filter(
      (c) => c.status === "placeholder" && (!targetIds || targetIds.has(c.id)),
    );

    if (placeholderRows.length === 0) {
      return {
        success: true,
        message: "No placeholder cast members found to outreach for.",
        data: { productionId, outreached: [] },
      };
    }

    const allReps = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.role, "rep"))
      .all();

    if (allReps.length === 0) {
      return {
        success: false,
        message: "No rep users are registered in the system. Invite reps first via invite_user.",
      };
    }

    const baseUrl = getBaseUrl();
    const outreached: Array<{ actorName: string; castId: string; repsContacted: string[] }> = [];
    const errors: string[] = [];

    for (const row of placeholderRows) {
      const actorName = row.actorName ?? "Unknown actor";

      // Try to find reps already linked to a talent with this TMDB ID
      let targetReps = allReps;
      if (row.tmdbId != null) {
        const matchedProfile = await db
          .select({ userId: talentProfiles.userId })
          .from(talentProfiles)
          .where(eq(talentProfiles.tmdbId, row.tmdbId))
          .get();

        if (matchedProfile) {
          const linkedRepRows = await db
            .select({ repId: talentReps.repId })
            .from(talentReps)
            .where(eq(talentReps.talentId, matchedProfile.userId))
            .all();

          if (linkedRepRows.length > 0) {
            const repIds = linkedRepRows.map((r) => r.repId);
            const specificReps = await db
              .select({ id: users.id, email: users.email })
              .from(users)
              .where(inArray(users.id, repIds))
              .all();
            if (specificReps.length > 0) targetReps = specificReps;
          }
        }
      }

      const repsToContact = targetReps.slice(0, MAX_OUTREACH_REPS);
      const contacted: string[] = [];

      for (const rep of repsToContact) {
        try {
          const { subject, html } = repRepresentationEnquiryEmail({
            repEmail: rep.email,
            actorName,
            characterName: row.characterName ?? undefined,
            productionName: production.name,
            companyName: production.company,
            coordinatorEmail: token.email,
            rosterUrl: `${baseUrl}/roster`,
          });
          await sendEmail({ to: rep.email, subject, html }).catch(() => {});
          contacted.push(rep.email);
        } catch (err) {
          errors.push(
            `${actorName} → ${rep.email}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      outreached.push({ actorName, castId: row.id, repsContacted: contacted });
    }

    const totalEmails = outreached.reduce((sum, o) => sum + o.repsContacted.length, 0);
    return {
      success: errors.length === 0,
      message:
        `Sent ${totalEmails} representation enquiry email${totalEmails !== 1 ? "s" : ""} ` +
        `for ${outreached.length} cast member${outreached.length !== 1 ? "s" : ""}.` +
        (errors.length ? ` ${errors.length} error(s).` : ""),
      data: { productionId, outreached, errors },
    };
  },
});
