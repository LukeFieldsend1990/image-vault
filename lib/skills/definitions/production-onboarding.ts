import { registerSkill } from "../registry";
import type { SkillDefinition } from "../types";
import { invites, users, productions } from "@/lib/db/schema";
import { eq, and, isNull, gt, like } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { inviteEmail } from "@/lib/email/templates";
import { isAdmin } from "@/lib/auth/adminEmails";
import { resolveCompanyOrg } from "@/lib/organisations/resolveCompany";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

const skill: SkillDefinition = {
  id: "production-onboarding",
  name: "Onboard Production",
  description:
    "Register a production company and production, then invite the coordinator to join as an industry user",
  categories: ["onboarding", "introduction", "licence_request"],
  parameters: [
    {
      name: "coordinator_email",
      type: "string",
      description: "Email address of the production coordinator to invite",
      required: true,
    },
    {
      name: "production_name",
      type: "string",
      description: "Name of the production (film title, series name, etc.)",
      required: true,
    },
    {
      name: "company_name",
      type: "string",
      description: "Production company name — leave blank if unknown",
      required: false,
    },
    {
      name: "production_type",
      type: "select",
      description: "Type of production",
      required: false,
      options: ["film", "tv_series", "tv_movie", "commercial", "game", "music_video", "other"],
    },
    {
      name: "year",
      type: "number",
      description: "Production year (e.g. 2026)",
      required: false,
    },
    {
      name: "message",
      type: "string",
      description: "Optional personal message to include in the invite email",
      required: false,
    },
  ],

  async execute(ctx, params) {
    const { session, db } = ctx;

    if (!isAdmin(session.email) && session.role !== "talent") {
      return { success: false, message: "You don't have permission to onboard productions." };
    }

    const email = (params.coordinator_email as string)?.toLowerCase().trim();
    const productionName = (params.production_name as string)?.trim();
    const companyName = (params.company_name as string)?.trim() || null;
    const productionType = params.production_type as
      | "film"
      | "tv_series"
      | "tv_movie"
      | "commercial"
      | "game"
      | "music_video"
      | "other"
      | undefined;
    const year = typeof params.year === "number" ? Math.floor(params.year) : null;
    const messageParam = (params.message as string)?.trim() || null;

    if (!email || !productionName) {
      return { success: false, message: "Coordinator email and production name are required." };
    }

    const now = Math.floor(Date.now() / 1000);

    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .get();

    if (existingUser) {
      return { success: false, message: "An account with that email already exists." };
    }

    const existingInvite = await db
      .select({ id: invites.id })
      .from(invites)
      .where(and(eq(invites.email, email), isNull(invites.usedAt), gt(invites.expiresAt, now)))
      .get();

    if (existingInvite) {
      return { success: false, message: "A pending invite already exists for that email." };
    }

    // Resolve the production company → unified organisation (member-less until
    // the coordinator accepts the invite below). Skip if no name provided.
    let company: { id: string; name: string } | null = null;
    let orgId: string | null = null;
    if (companyName) {
      const refs = await resolveCompanyOrg(db, { name: companyName, createdBy: session.sub });
      company = { id: refs.productionCompanyId, name: companyName };
      orgId = refs.organisationId;
    }

    // Upsert production — match by name (scoped to company if known), then create
    const productionWhere = company
      ? and(like(productions.name, productionName), eq(productions.companyId, company.id))
      : like(productions.name, productionName);

    let production = await db
      .select({ id: productions.id, name: productions.name })
      .from(productions)
      .where(productionWhere)
      .get();

    if (!production) {
      const productionId = crypto.randomUUID();
      await db.insert(productions).values({
        id: productionId,
        name: productionName,
        companyId: company?.id ?? null,
        organisationId: orgId,
        type: productionType ?? null,
        year,
        status: "pre_production",
        coordinatorId: session.sub,
        createdAt: now,
        updatedAt: now,
      });
      production = { id: productionId, name: productionName };
    }

    const inviteId = crypto.randomUUID();
    const expiresAt = now + SEVEN_DAYS;

    const productionLabel = companyName ? `${productionName} (${companyName})` : productionName;
    const message =
      messageParam ??
      `You've been invited to manage scan licence access for ${productionLabel} on Image Vault.`;

    await db.insert(invites).values({
      id: inviteId,
      email,
      role: "industry",
      invitedBy: session.sub,
      talentId: null,
      message,
      usedAt: null,
      expiresAt,
      createdAt: now,
      orgSubtype: "production_company",
      organisationId: orgId,
      productionId: production.id,
    });

    const baseUrl = (ctx.env.NEXT_PUBLIC_BASE_URL as string) ?? "https://imagevault.ai";
    const { subject, html } = inviteEmail({
      to: email,
      inviterEmail: session.email,
      role: "industry",
      message,
      signupUrl: `${baseUrl}/signup?invite=${inviteId}`,
      expiresAt,
    });
    await sendEmail({ to: email, subject, html });

    return {
      success: true,
      message: `${productionName} registered and invite sent to ${email}.`,
      data: {
        inviteId,
        companyId: company?.id ?? null,
        companyName: company?.name ?? null,
        productionId: production.id,
        productionName: production.name,
        coordinatorEmail: email,
      },
    };
  },
};

registerSkill(skill);
