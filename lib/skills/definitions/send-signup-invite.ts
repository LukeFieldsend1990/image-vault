import { registerSkill } from "../registry";
import type { SkillDefinition } from "../types";
import { invites, users } from "@/lib/db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { inviteEmail } from "@/lib/email/templates";
import { isAdmin } from "@/lib/auth/adminEmails";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

const skill: SkillDefinition = {
  id: "send-signup-invite",
  name: "Send Signup Invite",
  description: "Send a platform invitation to onboard a new user",
  categories: ["onboarding", "introduction"],
  parameters: [
    {
      name: "email",
      type: "string",
      description: "Email address to invite",
      required: true,
    },
    {
      name: "role",
      type: "select",
      description: "Account type for the invitee",
      required: true,
      options: ["talent", "rep", "licensee"],
      default: "talent",
    },
    {
      name: "message",
      type: "string",
      description: "Optional personal message to include in the invite",
      required: false,
    },
  ],

  async execute(ctx, params) {
    const { session, db } = ctx;

    // Only admins and talent can send invites
    if (!isAdmin(session.email) && session.role !== "talent") {
      return { success: false, message: "You don't have permission to send invites." };
    }

    const email = (params.email as string)?.toLowerCase().trim();
    const role = params.role as "talent" | "rep" | "licensee";
    const message = (params.message as string)?.trim() || null;

    if (!email || !role) {
      return { success: false, message: "Email and role are required." };
    }

    if (!["talent", "rep", "licensee"].includes(role)) {
      return { success: false, message: "Invalid role." };
    }

    // Talent can only invite rep or licensee
    if (!isAdmin(session.email) && session.role === "talent" && role === "talent") {
      return { success: false, message: "Talent accounts can only invite reps or licensees." };
    }

    const now = Math.floor(Date.now() / 1000);

    // Check for existing user
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .get();

    if (existingUser) {
      return { success: false, message: "An account with that email already exists." };
    }

    // Check for existing pending invite
    const existingInvite = await db
      .select({ id: invites.id })
      .from(invites)
      .where(
        and(
          eq(invites.email, email),
          isNull(invites.usedAt),
          gt(invites.expiresAt, now)
        )
      )
      .get();

    if (existingInvite) {
      return { success: false, message: "A pending invite already exists for that email." };
    }

    const inviteId = crypto.randomUUID();
    const expiresAt = now + SEVEN_DAYS;

    await db.insert(invites).values({
      id: inviteId,
      email,
      role,
      invitedBy: session.sub,
      talentId: session.role === "talent" && role === "rep" ? session.sub : null,
      message,
      usedAt: null,
      expiresAt,
      createdAt: now,
    });

    const baseUrl = (ctx.env.NEXT_PUBLIC_BASE_URL as string) ?? "https://changling.io";
    const { subject, html } = inviteEmail({
      to: email,
      inviterEmail: session.email,
      role,
      message,
      signupUrl: `${baseUrl}/signup?invite=${inviteId}`,
      expiresAt,
    });
    await sendEmail({ to: email, subject, html });

    return {
      success: true,
      message: `Invite sent to ${email} as ${role}.`,
      data: { inviteId, email, role },
    };
  },
};

registerSkill(skill);
