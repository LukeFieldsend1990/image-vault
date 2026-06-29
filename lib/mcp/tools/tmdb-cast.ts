/**
 * TMDB-backed cast suggestion and bulk population tools.
 *
 * suggest_production_cast (read)    — fetch TMDB credits for a production.
 *   If the production has no tmdbId, searches TMDB by title first and returns
 *   candidates (same flow as the webapp's title-search UI). Matches platform
 *   talent by TMDB ID and by name, mirroring /api/productions/[id]/cast/tmdb.
 *
 * link_production_tmdb (mutating)   — save the chosen TMDB ID to the production
 *   record (and infer production type from TMDB media type if not set).
 *
 * populate_cast_from_tmdb (mutating) — add selected TMDB actors to a production:
 *   registered talent (matched by TMDB ID or name) get a linked AWAITING_PACKAGE
 *   licence; others become placeholders.
 *
 * outreach_unlinked_cast (mutating) — email rep users asking whether they represent
 *   a placeholder cast member so the connection can be established and an invite sent.
 *
 * Intended flow:
 *   1. suggest_production_cast       → if no tmdbId, returns title candidates
 *   2. link_production_tmdb          → saves chosen TMDB ID to production record
 *   3. suggest_production_cast       → now returns cast suggestions with platform status
 *   4. populate_cast_from_tmdb       → adds linked (registered) + placeholder rows
 *   5. outreach_unlinked_cast        → emails reps for placeholder rows
 *   6. resolve_cast_member           → once a rep confirms, attach email + invite
 */


import { getCloudflareContext } from "@opennextjs/cloudflare";


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
    const { env } = getCloudflareContext();
    const e = env as unknown as Record<string, string | undefined>;
    return e.TMDB_API_KEY ?? null;
  } catch {
    return process.env.TMDB_API_KEY ?? null;
  }
}

function getBaseUrl(): string {
  try {
    const { env } = getCloudflareContext();
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

interface TmdbTitleCandidate {
  tmdbId: number;
  title: string;
  mediaType: "movie" | "tv";
  year: number | null;
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

async function searchTmdbByTitle(title: string): Promise<TmdbTitleCandidate[] | null> {
  const apiKey = getTmdbKey();
  if (!apiKey) return null;
  const url = `${TMDB_BASE}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(title)}&include_adult=false`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json() as {
    results?: Array<{
      id: number;
      media_type: string;
      title?: string;
      name?: string;
      release_date?: string;
      first_air_date?: string;
    }>;
  };
  return (data.results ?? [])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 8)
    .map((r) => {
      const dateStr = r.release_date ?? r.first_air_date ?? "";
      const year = dateStr ? parseInt(dateStr.slice(0, 4), 10) : null;
      return {
        tmdbId: r.id,
        title: r.title ?? r.name ?? "Untitled",
        mediaType: r.media_type as "movie" | "tv",
        year: year && !isNaN(year) ? year : null,
      };
    });
}

// ── suggest_production_cast ──────────────────────────────────────────────────

registerMcpTool({
  name: "suggest_production_cast",
  description:
    "Fetch the TMDB cast list for a production and show which actors are already on Image Vault. " +
    "If the production has no tmdbId set, this tool automatically searches TMDB by the production title " +
    "and returns up to 8 title candidates — the same flow as the webapp's title-search UI. " +
    "Pick the correct candidate and call link_production_tmdb to save its tmdbId, then call this tool again " +
    "to see the cast. Alternatively, pass overrideTmdbId to preview a specific TMDB ID without saving it. " +
    "Platform matching uses both TMDB ID and full name (case-insensitive), mirroring the webapp. " +
    "Each actor's platformStatus: 'registered' (on Image Vault), 'on_cast' (already added to this production), " +
    "or 'not_on_platform'. Pass selected actors to populate_cast_from_tmdb.",
  inputSchema: {
    type: "object",
    properties: {
      productionId: { type: "string", description: "Production UUID" },
      overrideTmdbId: {
        type: "number",
        description:
          "Use this TMDB ID for the credits fetch without saving it to the production record. " +
          "Useful for previewing candidates before committing. Use link_production_tmdb to save.",
      },
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

    if (!getTmdbKey()) {
      return { success: false, message: "TMDB_API_KEY is not configured on this environment." };
    }

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

    const overrideTmdbId =
      typeof params.overrideTmdbId === "number" && params.overrideTmdbId > 0
        ? Math.floor(params.overrideTmdbId)
        : null;
    const resolvedTmdbId = overrideTmdbId ?? production.tmdbId;

    // No tmdbId and no override → search by title and return candidates
    if (!resolvedTmdbId) {
      const candidates = await searchTmdbByTitle(production.name);
      if (!candidates) {
        return {
          success: false,
          message: `TMDB title search failed for "${production.name}".`,
        };
      }
      if (candidates.length === 0) {
        return {
          success: false,
          message:
            `No TMDB results found for "${production.name}". ` +
            "Try link_production_tmdb with a tmdbId found via TMDB directly.",
        };
      }
      return {
        success: true,
        message:
          `"${production.name}" has no TMDB ID. ${candidates.length} title candidate(s) found. ` +
          "Pick the correct one and call link_production_tmdb(productionId, tmdbId) to save it, " +
          "then call suggest_production_cast again to see the cast list.",
        data: {
          productionId,
          needsTmdbLink: true,
          candidates,
        },
      };
    }

    const credits = await fetchTmdbCredits(resolvedTmdbId, production.type);
    if (!credits) {
      return {
        success: false,
        message: `Could not fetch TMDB credits (tmdbId: ${resolvedTmdbId}).`,
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
        message: `No cast found on TMDB for "${production.name}".`,
        data: { productionId, cast: [] },
      };
    }

    // Load all talent profiles for matching (by tmdbId and by name) — same as webapp
    const allProfiles = await db
      .select({
        userId: talentProfiles.userId,
        fullName: talentProfiles.fullName,
        tmdbId: talentProfiles.tmdbId,
      })
      .from(talentProfiles)
      .all();

    const profileByTmdbId = new Map<number, string>(); // tmdbId → userId
    const profileByName = new Map<string, string>();    // lower name → userId
    for (const p of allProfiles) {
      if (p.tmdbId != null) profileByTmdbId.set(p.tmdbId, p.userId);
      profileByName.set(p.fullName.toLowerCase(), p.userId);
    }

    // Existing cast rows on this production (by tmdbId for status reporting)
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
      // Match by TMDB ID first, fall back to name (same as webapp)
      const talentId =
        profileByTmdbId.get(member.id) ??
        profileByName.get(member.name.toLowerCase()) ??
        null;

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
        talentId,
      };
    });

    const registered = cast.filter((c) => c.platformStatus === "registered").length;
    const onCast = cast.filter((c) => c.platformStatus === "on_cast").length;
    const notOnPlatform = cast.filter((c) => c.platformStatus === "not_on_platform").length;
    const overrideNote = overrideTmdbId ? ` (using override tmdbId ${overrideTmdbId} — call link_production_tmdb to save it)` : "";

    return {
      success: true,
      message:
        `${cast.length} cast member(s) from TMDB for "${production.name}"${overrideNote}: ` +
        `${registered} registered on platform, ${onCast} already on cast, ${notOnPlatform} not on platform.`,
      data: { productionId, productionName: production.name, tmdbId: resolvedTmdbId, cast },
    };
  },
});

// ── link_production_tmdb ─────────────────────────────────────────────────────

const PRODUCTION_TYPES_MAP: Record<string, "film" | "tv_series" | "tv_movie"> = {
  movie: "film",
  tv: "tv_series",
};

registerMcpTool({
  name: "link_production_tmdb",
  description:
    "Save a TMDB ID to a production record so suggest_production_cast can fetch its cast. " +
    "Call suggest_production_cast first (it returns title candidates when no tmdbId is set), " +
    "pick the correct one, then call this tool with its tmdbId. " +
    "If the production type is not yet set, it is inferred from the TMDB mediaType (movie → film, tv → tv_series).",
  inputSchema: {
    type: "object",
    properties: {
      productionId: { type: "string", description: "Production UUID" },
      tmdbId: {
        type: "number",
        description: "TMDB title ID to save (from the candidates returned by suggest_production_cast)",
      },
      mediaType: {
        type: "string",
        enum: ["movie", "tv"],
        description: "TMDB media type of the chosen candidate — used to infer the production type if not already set",
      },
    },
    required: ["productionId", "tmdbId"],
  },
  mutating: true,
  async execute({ db }, params) {
    const productionId = trimmed(params.productionId);
    if (!productionId) return { success: false, message: "productionId is required." };

    const tmdbId =
      typeof params.tmdbId === "number" && Number.isFinite(params.tmdbId) && params.tmdbId > 0
        ? Math.floor(params.tmdbId)
        : null;
    if (!tmdbId) return { success: false, message: "A valid tmdbId (positive integer) is required." };

    const production = await db
      .select({ id: productions.id, name: productions.name, tmdbId: productions.tmdbId, type: productions.type })
      .from(productions)
      .where(eq(productions.id, productionId))
      .get();
    if (!production) return { success: false, message: `No production with id ${productionId}.` };

    const mediaType =
      params.mediaType === "movie" || params.mediaType === "tv" ? params.mediaType : null;
    const inferredType =
      !production.type && mediaType ? PRODUCTION_TYPES_MAP[mediaType] ?? null : null;

    const now = Math.floor(Date.now() / 1000);
    await db
      .update(productions)
      .set({
        tmdbId,
        ...(inferredType ? { type: inferredType } : {}),
        updatedAt: now,
      })
      .where(eq(productions.id, productionId));

    const prev = production.tmdbId ? ` (was ${production.tmdbId})` : "";
    const typeNote = inferredType ? ` Production type set to ${inferredType}.` : "";
    return {
      success: true,
      message:
        `TMDB ID ${tmdbId} saved to "${production.name}"${prev}.${typeNote} ` +
        "Call suggest_production_cast to fetch the cast list.",
      data: { productionId, tmdbId, inferredType },
    };
  },
});

// ── populate_cast_from_tmdb ──────────────────────────────────────────────────

registerMcpTool({
  name: "populate_cast_from_tmdb",
  description:
    "Add selected TMDB actors to a production's cast. Pass members from suggest_production_cast " +
    "(tmdbPersonId + name, optionally characterName/department/sagMember). " +
    "Platform matching uses TMDB ID first, then falls back to full name (case-insensitive), " +
    "mirroring the webapp. Registered talent get an AWAITING_PACKAGE licence + linked cast row + email. " +
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
            department: { type: "string", description: "e.g. 'Lead', 'Supporting', 'Stunt'" },
            sagMember: { type: "boolean", description: "Whether the actor is a SAG-AFTRA member" },
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
      .select({ id: productions.id, name: productions.name, company: companyNameSql, organisationId: productions.organisationId })
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
        // Skip if already on this production's cast
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

        // Match by TMDB ID first, then by name — same as the webapp
        let profile = await db
          .select({ userId: talentProfiles.userId })
          .from(talentProfiles)
          .where(eq(talentProfiles.tmdbId, tmdbPersonId))
          .get() ?? null;

        if (!profile) {
          profile = await db
            .select({ userId: talentProfiles.userId })
            .from(talentProfiles)
            .where(sql`lower(${talentProfiles.fullName}) = ${name.toLowerCase()}`)
            .get() ?? null;
        }

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
            organisationId: production.organisationId,
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
              reviewUrl: `${baseUrl}/licences?highlight=${licenceId}`,
            });
            await sendEmail({ to: talentUser.email, subject, html }).catch(() => {});
          }
          linked++;
        } else {
          // Not on platform — placeholder row
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
      .select({ id: productions.id, name: productions.name, company: companyNameSql, organisationId: productions.organisationId })
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
