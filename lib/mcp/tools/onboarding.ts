/**
 * Onboarding tools: invite users, form productions, create licence requests.
 * All mutating — the dispatcher enforces admin scope + per-call TOTP.
 * Each reuses the same DB writes and email templates as the corresponding
 * in-app flow (send-signup-invite skill, /api/productions, /api/licences).
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { registerMcpTool } from "../registry";
import {
  users,
  invites,
  productions,
  productionCompanies,
  scanPackages,
  licences,
} from "@/lib/db/schema";
import { eq, and, isNull, gt, sql } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import {
  inviteEmail,
  licenceRequestedEmail,
  placeholderLicenceCreatedEmail,
} from "@/lib/email/templates";
import { appendEvent, licenceChain } from "@/lib/compliance/ledger";
import { isIndustryRole } from "@/lib/auth/roles";
import type { McpToolContext } from "../types";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

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

async function findUserByEmail(ctx: McpToolContext, emailParam: unknown) {
  const email = typeof emailParam === "string" ? emailParam.trim().toLowerCase() : "";
  if (!email) return null;
  return await ctx.db
    .select({ id: users.id, email: users.email, role: users.role, vaultLocked: users.vaultLocked })
    .from(users)
    .where(eq(users.email, email))
    .get() ?? null;
}

registerMcpTool({
  name: "invite_user",
  description:
    "Onboard someone by email: creates a 7-day signup invite and sends the invitation email. " +
    "Use role=talent for actors. Include the person's name and context in the message so they recognise the invite.",
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Email address to invite" },
      role: { type: "string", enum: ["talent", "rep", "industry", "licensee"], description: "Account type (default talent)" },
      message: { type: "string", description: "Optional personal note included in the invite email (e.g. who it's for and why)" },
    },
    required: ["email"],
  },
  mutating: true,
  async execute({ db, token }, params) {
    const email = typeof params.email === "string" ? params.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) return { success: false, message: "A valid email is required." };

    const role = params.role === "rep" || params.role === "licensee" || params.role === "industry" ? params.role : "talent";
    const message = typeof params.message === "string" && params.message.trim() ? params.message.trim() : null;
    const now = Math.floor(Date.now() / 1000);

    const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
    if (existingUser) return { success: false, message: `An account with ${email} already exists.` };

    const existingInvite = await db
      .select({ id: invites.id })
      .from(invites)
      .where(and(eq(invites.email, email), isNull(invites.usedAt), gt(invites.expiresAt, now)))
      .get();
    if (existingInvite) return { success: false, message: `A pending invite already exists for ${email}.` };

    const inviteId = crypto.randomUUID();
    const expiresAt = now + SEVEN_DAYS;

    await db.insert(invites).values({
      id: inviteId,
      email,
      role,
      invitedBy: token.userId,
      talentId: null,
      message,
      usedAt: null,
      expiresAt,
      createdAt: now,
    });

    const { subject, html } = inviteEmail({
      to: email,
      inviterEmail: token.email,
      role,
      message,
      signupUrl: `${getBaseUrl()}/signup?invite=${inviteId}`,
      expiresAt,
    });
    await sendEmail({ to: email, subject, html });

    return {
      success: true,
      message: `Invite sent to ${email} as ${role} (expires in 7 days).`,
      data: { inviteId, email, role, expiresAt },
    };
  },
});

const PRODUCTION_TYPES = ["film", "tv_series", "tv_movie", "commercial", "game", "music_video", "other"] as const;
const PRODUCTION_STATUSES = ["development", "pre_production", "production", "post_production", "released", "cancelled"] as const;

registerMcpTool({
  name: "create_production",
  description:
    "Create a production. If companyName is given, the production company is looked up by name or created. " +
    "The calling admin becomes the production coordinator.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Production title" },
      companyName: { type: "string", description: "Production company name (matched case-insensitively or created)" },
      type: { type: "string", enum: [...PRODUCTION_TYPES], description: "Production type" },
      year: { type: "number", description: "Production year" },
      status: { type: "string", enum: [...PRODUCTION_STATUSES], description: "Production status" },
      director: { type: "string", description: "Director name" },
      notes: { type: "string", description: "Internal notes" },
      sagProjectNumber: { type: "string", description: "SAG-AFTRA project number" },
    },
    required: ["name"],
  },
  mutating: true,
  async execute({ db, token }, params) {
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!name) return { success: false, message: "name is required." };

    const type = PRODUCTION_TYPES.includes(params.type as typeof PRODUCTION_TYPES[number])
      ? (params.type as typeof PRODUCTION_TYPES[number]) : null;
    const status = PRODUCTION_STATUSES.includes(params.status as typeof PRODUCTION_STATUSES[number])
      ? (params.status as typeof PRODUCTION_STATUSES[number]) : null;
    const year = typeof params.year === "number" && params.year > 1900 && params.year < 2100
      ? Math.floor(params.year) : null;

    const now = Math.floor(Date.now() / 1000);

    // Resolve or create the production company by name
    let companyId: string | null = null;
    let companyCreated = false;
    const companyName = typeof params.companyName === "string" ? params.companyName.trim() : "";
    if (companyName) {
      const existing = await db
        .select({ id: productionCompanies.id })
        .from(productionCompanies)
        .where(sql`lower(${productionCompanies.name}) = ${companyName.toLowerCase()}`)
        .get();
      if (existing) {
        companyId = existing.id;
      } else {
        companyId = crypto.randomUUID();
        companyCreated = true;
        await db.insert(productionCompanies).values({
          id: companyId,
          name: companyName,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const productionId = crypto.randomUUID();
    await db.insert(productions).values({
      id: productionId,
      name,
      companyId,
      type,
      year,
      status,
      director: typeof params.director === "string" && params.director.trim() ? params.director.trim() : null,
      notes: typeof params.notes === "string" && params.notes.trim() ? params.notes.trim() : null,
      sagProjectNumber:
        typeof params.sagProjectNumber === "string" && params.sagProjectNumber.trim()
          ? params.sagProjectNumber.trim() : null,
      coordinatorId: token.userId,
      createdAt: now,
      updatedAt: now,
    });

    return {
      success: true,
      message: `Created production "${name}"${companyName ? ` for ${companyName}${companyCreated ? " (new company)" : ""}` : ""}.`,
      data: { productionId, companyId, companyCreated },
    };
  },
});

const LICENCE_TYPES = ["film_double", "game_character", "commercial", "ai_avatar", "training_data", "monitoring_reference"] as const;

registerMcpTool({
  name: "create_licence_request",
  description:
    "Create a licence request between a talent and a licensee. With packageId: a standard PENDING request " +
    "for the talent to approve (package must be ready, vault must be unlocked). Without packageId: an " +
    "AWAITING_PACKAGE placeholder that attaches when the talent uploads. Notification emails are sent either way. " +
    "Use list_packages to find package IDs.",
  inputSchema: {
    type: "object",
    properties: {
      talentEmail: { type: "string", description: "Talent's account email" },
      licenseeEmail: { type: "string", description: "Licensee's account email" },
      packageId: { type: "string", description: "Scan package UUID (omit for a placeholder licence)" },
      projectName: { type: "string", description: "Project name" },
      productionCompany: { type: "string", description: "Production company name" },
      intendedUse: { type: "string", description: "What the likeness will be used for" },
      validFrom: { type: "string", description: "Licence start date, YYYY-MM-DD" },
      validTo: { type: "string", description: "Licence end date, YYYY-MM-DD" },
      licenceType: { type: "string", enum: [...LICENCE_TYPES], description: "Licence type" },
      proposedFeeCents: { type: "number", description: "Proposed fee in cents" },
    },
    required: ["talentEmail", "licenseeEmail", "projectName", "productionCompany", "intendedUse", "validFrom", "validTo"],
  },
  mutating: true,
  async execute(ctx, params) {
    const { db, token } = ctx;

    const projectName = typeof params.projectName === "string" ? params.projectName.trim() : "";
    const productionCompany = typeof params.productionCompany === "string" ? params.productionCompany.trim() : "";
    const intendedUse = typeof params.intendedUse === "string" ? params.intendedUse.trim() : "";
    if (!projectName || !productionCompany || !intendedUse) {
      return { success: false, message: "projectName, productionCompany and intendedUse are required." };
    }

    const validFrom = parseDate(params.validFrom);
    const validTo = parseDate(params.validTo);
    if (validFrom === null || validTo === null) {
      return { success: false, message: "validFrom and validTo must be YYYY-MM-DD dates." };
    }
    if (validTo <= validFrom) return { success: false, message: "validTo must be after validFrom." };

    const talent = await findUserByEmail(ctx, params.talentEmail);
    if (!talent) return { success: false, message: `No user with email ${String(params.talentEmail)}.` };
    if (talent.role !== "talent") {
      return { success: false, message: `${talent.email} is a ${talent.role} account, not talent.` };
    }
    const licensee = await findUserByEmail(ctx, params.licenseeEmail);
    if (!licensee) return { success: false, message: `No user with email ${String(params.licenseeEmail)}.` };
    if (!isIndustryRole(licensee.role)) {
      return { success: false, message: `${licensee.email} is a ${licensee.role} account, not a licensee.` };
    }

    const licenceType = LICENCE_TYPES.includes(params.licenceType as typeof LICENCE_TYPES[number])
      ? (params.licenceType as typeof LICENCE_TYPES[number]) : null;
    const proposedFee =
      typeof params.proposedFeeCents === "number" && params.proposedFeeCents > 0
        ? Math.floor(params.proposedFeeCents) : null;

    // Standard request needs a ready package owned by the talent and an unlocked vault
    const packageId = typeof params.packageId === "string" && params.packageId.trim() ? params.packageId.trim() : null;
    let packageName: string | null = null;
    if (packageId) {
      const pkg = await db
        .select({ id: scanPackages.id, name: scanPackages.name, talentId: scanPackages.talentId, status: scanPackages.status, deletedAt: scanPackages.deletedAt })
        .from(scanPackages)
        .where(eq(scanPackages.id, packageId))
        .get();
      if (!pkg || pkg.deletedAt !== null) return { success: false, message: `No active package with id ${packageId}.` };
      if (pkg.talentId !== talent.id) return { success: false, message: `Package "${pkg.name}" does not belong to ${talent.email}.` };
      if (pkg.status !== "ready") return { success: false, message: `Package "${pkg.name}" is not ready (status: ${pkg.status}).` };
      if (talent.vaultLocked) return { success: false, message: `${talent.email}'s vault is locked — a standard request cannot be created. Omit packageId for a placeholder instead.` };
      packageName = pkg.name;
    }

    const licenceId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const isPlaceholder = !packageId;

    await db.insert(licences).values({
      id: licenceId,
      talentId: talent.id,
      packageId,
      licenseeId: licensee.id,
      projectName,
      productionCompany,
      intendedUse,
      validFrom,
      validTo,
      fileScope: "all",
      status: isPlaceholder ? "AWAITING_PACKAGE" : "PENDING",
      licenceType,
      proposedFee,
      downloadCount: 0,
      createdAt: now,
    });

    // Article 39.J business reason on the licence's compliance chain (non-fatal)
    void appendEvent(db, {
      chainKey: licenceChain(licenceId),
      eventType: "business_reason.recorded",
      clauseRef: "39.J",
      licenceId,
      talentId: talent.id,
      actorId: token.userId,
      payload: { projectName, productionCompany, intendedUse },
    }).catch(() => {});

    const baseUrl = getBaseUrl();
    if (isPlaceholder) {
      const { subject, html } = placeholderLicenceCreatedEmail({
        licenseeEmail: licensee.email,
        projectName,
        productionCompany,
        validFrom,
        validTo,
        viewUrl: `${baseUrl}/licences`,
      });
      await sendEmail({ to: licensee.email, subject, html });
    } else {
      const { subject, html } = licenceRequestedEmail({
        talentEmail: talent.email,
        licenseeEmail: licensee.email,
        projectName,
        productionCompany,
        intendedUse,
        packageName: packageName ?? "package",
        validFrom,
        validTo,
        reviewUrl: `${baseUrl}/vault/requests`,
      });
      await sendEmail({ to: talent.email, subject, html });
    }

    return {
      success: true,
      message: isPlaceholder
        ? `Placeholder licence created for ${talent.email} ↔ ${licensee.email} — "${projectName}" (AWAITING_PACKAGE). Licensee notified.`
        : `Licence requested: "${projectName}" on package "${packageName}" — pending ${talent.email}'s approval. Talent notified.`,
      data: { licenceId, status: isPlaceholder ? "AWAITING_PACKAGE" : "PENDING", packageId },
    };
  },
});
