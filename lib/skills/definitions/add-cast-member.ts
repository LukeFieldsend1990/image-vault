import { registerSkill } from "../registry";
import type { SkillDefinition } from "../types";
import {
  productions,
  productionCompanies,
  productionCast,
  licences,
  invites,
  users,
  organisations,
} from "@/lib/db/schema";
import { eq, like } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { productionCastInviteEmail, productionCastLinkedEmail } from "@/lib/email/templates";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { mintLicenceCode } from "@/lib/codes/codes";

const ONE_YEAR = 365 * 24 * 60 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;

function parseDate(s: unknown): number | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}

const skill: SkillDefinition = {
  id: "add-cast-member",
  name: "Add Cast Member",
  description:
    "Add a talent to a production's cast — sends a scan invite if new, links a licence if they already have an account",
  categories: ["licence_request", "onboarding"],
  parameters: [
    {
      name: "production_name",
      type: "string",
      description: "Name of the production to add the cast member to",
      required: true,
    },
    {
      name: "actor_email",
      type: "string",
      description: "Talent's email address — if supplied, an invite or licence link is sent immediately",
      required: false,
    },
    {
      name: "actor_name",
      type: "string",
      description: "Talent's name — creates a placeholder row if email is not yet known",
      required: false,
    },
    {
      name: "character_name",
      type: "string",
      description: "Character or role name in the production",
      required: false,
    },
    {
      name: "intended_use",
      type: "select",
      description: "How the scan data will be used",
      required: false,
      options: [
        "film_double",
        "game_character",
        "commercial",
        "ai_avatar",
        "training_data",
        "monitoring_reference",
      ],
      default: "film_double",
    },
    {
      name: "licence_type",
      type: "select",
      description: "Licence category",
      required: false,
      options: [
        "film_double",
        "game_character",
        "commercial",
        "ai_avatar",
        "training_data",
        "monitoring_reference",
      ],
    },
    {
      name: "valid_from",
      type: "string",
      description: "Licence start date (ISO format, e.g. 2026-07-01) — defaults to today",
      required: false,
    },
    {
      name: "valid_to",
      type: "string",
      description: "Licence end date (ISO format, e.g. 2027-06-30) — defaults to one year from today",
      required: false,
    },
  ],

  async execute(ctx, params) {
    const { session, db } = ctx;

    if (!isAdmin(session.email) && !isIndustryRole(session.role)) {
      return { success: false, message: "Only industry users and admins can add cast members." };
    }

    const productionName = (params.production_name as string)?.trim();
    const actorEmail = (params.actor_email as string)?.toLowerCase().trim() || null;
    const actorName = (params.actor_name as string)?.trim() || null;
    const characterName = (params.character_name as string)?.trim() || null;
    const intendedUse = (params.intended_use as string) || "film_double";
    const licenceTypeRaw = (params.licence_type as string) || null;

    if (!productionName) {
      return { success: false, message: "Production name is required." };
    }
    if (!actorEmail && !actorName) {
      return { success: false, message: "Provide an actor email or name (or both)." };
    }

    const now = Math.floor(Date.now() / 1000);
    const validFrom = parseDate(params.valid_from) ?? now;
    const validTo = parseDate(params.valid_to) ?? now + ONE_YEAR;

    // Find the production
    const production = await db
      .select({
        id: productions.id,
        name: productions.name,
        companyId: productions.companyId,
        organisationId: productions.organisationId,
      })
      .from(productions)
      .where(like(productions.name, productionName))
      .get();

    if (!production) {
      return {
        success: false,
        message: `Production "${productionName}" not found. Run the Onboard Production skill first if this is a new production.`,
      };
    }

    // Resolve company name for email templates
    let companyName = "Production Company";
    if (production.companyId) {
      const co = await db
        .select({ name: productionCompanies.name })
        .from(productionCompanies)
        .where(eq(productionCompanies.id, production.companyId))
        .get();
      if (co) companyName = co.name;
    } else if (production.organisationId) {
      const org = await db
        .select({ name: organisations.name })
        .from(organisations)
        .where(eq(organisations.id, production.organisationId))
        .get();
      if (org) companyName = org.name;
    }

    const coordinatorEmail = session.email;
    const baseUrl = (ctx.env.NEXT_PUBLIC_BASE_URL as string) ?? "https://changling.io";

    const licenceTermsBlob = {
      intendedUse,
      validFrom,
      validTo,
      licenceType: licenceTypeRaw,
      territory: null,
      exclusivity: "non_exclusive",
      permitAiTraining: false,
      proposedFee: null,
      projectName: production.name,
      productionCompany: companyName,
    };

    // ── Placeholder: no email yet ────────────────────────────────────────────
    if (!actorEmail) {
      await db.insert(productionCast).values({
        id: crypto.randomUUID(),
        productionId: production.id,
        talentId: null,
        inviteId: null,
        licenceId: null,
        actorName,
        tmdbId: null,
        sourceNote: "Added via email triage skill",
        characterName,
        department: null,
        sagMember: false,
        status: "placeholder",
        licenceTermsJson: JSON.stringify(licenceTermsBlob),
        addedBy: session.sub,
        addedAt: now,
        linkedAt: null,
      });

      return {
        success: true,
        message: `${actorName} added as a placeholder on ${production.name}. Resolve later once their email is known.`,
        data: { productionId: production.id, status: "placeholder", actorName },
      };
    }

    // ── Contactable: look up by email ────────────────────────────────────────
    const existingUser = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, actorEmail))
      .get();

    if (existingUser && existingUser.role === "talent") {
      // Existing talent — create licence + cast row immediately
      const licenceId = crypto.randomUUID();

      await db.insert(licences).values({
        id: licenceId,
        talentId: existingUser.id,
        licenseeId: session.sub,
        projectName: production.name,
        productionCompany: companyName,
        intendedUse,
        validFrom,
        validTo,
        status: "AWAITING_PACKAGE",
        licenceType: (licenceTypeRaw as typeof licences.$inferInsert["licenceType"]) ?? null,
        territory: null,
        exclusivity: "non_exclusive",
        permitAiTraining: false,
        proposedFee: null,
        productionId: production.id,
        organisationId: production.organisationId ?? null,
        createdAt: now,
      });
      await mintLicenceCode(db, licenceId);

      await db.insert(productionCast).values({
        id: crypto.randomUUID(),
        productionId: production.id,
        talentId: existingUser.id,
        inviteId: null,
        licenceId,
        actorName: actorName ?? null,
        characterName,
        department: null,
        sagMember: false,
        status: "linked",
        licenceTermsJson: null,
        addedBy: session.sub,
        addedAt: now,
        linkedAt: now,
      });

      void (async () => {
        const { subject, html } = productionCastLinkedEmail({
          recipientEmail: actorEmail,
          productionName: production.name,
          companyName,
          coordinatorEmail,
          characterName: characterName ?? undefined,
          intendedUse,
          proposedFee: undefined,
          reviewUrl: `${baseUrl}/licences/${licenceId}`,
        });
        await sendEmail({ to: actorEmail, subject, html });
      })();

      return {
        success: true,
        message: `${actorEmail} linked to ${production.name} — licence created and notification sent.`,
        data: { productionId: production.id, licenceId, status: "linked", actorEmail },
      };
    }

    // ── New talent — create invite + cast row with stored licence terms ───────
    const inviteId = crypto.randomUUID();
    const expiresAt = now + SEVEN_DAYS;

    await db.insert(invites).values({
      id: inviteId,
      email: actorEmail,
      role: "talent",
      invitedBy: session.sub,
      talentId: null,
      message: `You've been invited to join the cast of ${production.name}.`,
      usedAt: null,
      expiresAt,
      createdAt: now,
      productionId: production.id,
    });

    await db.insert(productionCast).values({
      id: crypto.randomUUID(),
      productionId: production.id,
      talentId: null,
      inviteId,
      licenceId: null,
      actorName: actorName ?? null,
      characterName,
      department: null,
      sagMember: false,
      status: "invited",
      licenceTermsJson: JSON.stringify(licenceTermsBlob),
      addedBy: session.sub,
      addedAt: now,
      linkedAt: null,
    });

    void (async () => {
      const { subject, html } = productionCastInviteEmail({
        recipientEmail: actorEmail,
        productionName: production.name,
        companyName,
        coordinatorEmail,
        characterName: characterName ?? undefined,
        intendedUse,
        validFrom,
        validTo,
        signupUrl: `${baseUrl}/signup?invite=${inviteId}`,
      });
      await sendEmail({ to: actorEmail, subject, html });
    })();

    return {
      success: true,
      message: `Cast invite sent to ${actorEmail} for ${production.name}.`,
      data: { productionId: production.id, inviteId, status: "invited", actorEmail },
    };
  },
};

registerSkill(skill);
