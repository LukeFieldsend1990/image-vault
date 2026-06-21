/**
 * Path C — agent-mediated cast resolution.
 *
 * A production company often knows the representing agency even when it doesn't
 * have the actor's personal email. Here we let a producer assign a reserved cast
 * slot to a rep (existing on Image Vault, or invited by email), and notify them.
 * The rep later resolves the slot by supplying their client's email — which goes
 * through the normal promote machinery, with the *producer* as the licensee.
 */

import { eq, and, isNull, gt } from "drizzle-orm";
import {
  users, invites, productions, productionCast, organisations, productionCompanies,
} from "@/lib/db/schema";
import { createNotification } from "@/lib/notifications/create";
import { sendEmail } from "@/lib/email/send";
import { castRepInviteEmail } from "@/lib/email/templates";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

const SEVEN_DAYS = 7 * 24 * 60 * 60;

async function companyNameFor(db: Db, production: { organisationId: string | null; companyId?: string | null }): Promise<string> {
  if (production.organisationId) {
    const org = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, production.organisationId)).get();
    if (org) return org.name;
  }
  if (production.companyId) {
    const c = await db.select({ name: productionCompanies.name }).from(productionCompanies).where(eq(productionCompanies.id, production.companyId)).get();
    if (c) return c.name;
  }
  return "A production company";
}

export interface InviteRepResult {
  ok: boolean;
  message: string;
  mode?: "existing" | "invited";
}

/**
 * Assign a reserved placeholder slot to a representing agent.
 * Provide `repUserId` (an existing rep) or `email` (free-text → signup invite).
 */
export async function inviteRepForCast(
  db: Db,
  opts: { productionId: string; castId: string; actorUserId: string; actorEmail: string; baseUrl: string; repUserId?: string; email?: string },
): Promise<InviteRepResult> {
  const cast = await db
    .select({
      id: productionCast.id,
      status: productionCast.status,
      repId: productionCast.repId,
      repInviteId: productionCast.repInviteId,
      actorName: productionCast.actorName,
      characterName: productionCast.characterName,
    })
    .from(productionCast)
    .where(and(eq(productionCast.id, opts.castId), eq(productionCast.productionId, opts.productionId)))
    .get();
  if (!cast) return { ok: false, message: "Cast member not found on this production." };
  if (cast.status !== "placeholder") return { ok: false, message: `Cast member is "${cast.status}", not a reservable placeholder.` };
  if (cast.repId || cast.repInviteId) return { ok: false, message: "Representation has already been invited for this role." };

  const production = await db
    .select({ id: productions.id, name: productions.name, organisationId: productions.organisationId, companyId: productions.companyId })
    .from(productions)
    .where(eq(productions.id, opts.productionId))
    .get();
  if (!production) return { ok: false, message: "Production not found." };
  const companyName = await companyNameFor(db, production);
  const rosterUrl = `${opts.baseUrl}/roster`;

  // Existing rep on Image Vault → assign + notify.
  if (opts.repUserId) {
    const rep = await db.select({ id: users.id, email: users.email, role: users.role, trueRole: users.trueRole }).from(users).where(eq(users.id, opts.repUserId)).get();
    if (!rep || (rep.trueRole ?? rep.role) !== "rep") return { ok: false, message: "That account is not a representative." };

    await db.update(productionCast).set({ repId: rep.id }).where(eq(productionCast.id, opts.castId));

    void createNotification(db, {
      userId: rep.id,
      type: "cast_rep_assigned",
      title: `${production.name} reserved a role for your client`,
      body: `${companyName} reserved ${cast.characterName ? `the role of ${cast.characterName}` : "a role"}${cast.actorName ? ` for ${cast.actorName}` : ""} on ${production.name}. Confirm your client's email to connect them.`,
      href: "/roster",
    });
    const { subject, html } = castRepInviteEmail({
      recipientEmail: rep.email, productionName: production.name, companyName,
      actorName: cast.actorName ?? undefined, characterName: cast.characterName ?? undefined,
      signupUrl: rosterUrl, rosterUrl, existing: true,
    });
    await sendEmail({ to: rep.email, subject, html }).catch(() => {});
    return { ok: true, mode: "existing", message: `Notified ${rep.email}.` };
  }

  // Free-text email → 7-day rep signup invite scoped to this cast slot.
  const email = (opts.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return { ok: false, message: "Provide an existing rep or a valid email." };

  const existingUser = await db.select({ id: users.id, role: users.role, trueRole: users.trueRole }).from(users).where(eq(users.email, email)).get();
  if (existingUser) {
    // The email already belongs to a rep → treat as existing-rep assignment.
    if ((existingUser.trueRole ?? existingUser.role) === "rep") {
      return inviteRepForCast(db, { ...opts, repUserId: existingUser.id, email: undefined });
    }
    return { ok: false, message: `${email} is already registered as a ${(existingUser.trueRole ?? existingUser.role)} account.` };
  }

  const now = Math.floor(Date.now() / 1000);
  const pending = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.email, email), eq(invites.role, "rep"), isNull(invites.usedAt), gt(invites.expiresAt, now)))
    .get();
  if (pending) return { ok: false, message: `${email} already has a pending invite.` };

  const inviteId = crypto.randomUUID();
  await db.insert(invites).values({
    id: inviteId,
    email,
    role: "rep",
    invitedBy: opts.actorUserId,
    talentId: null,
    message: `${companyName} invited you to represent a client on ${production.name}.`,
    usedAt: null,
    expiresAt: now + SEVEN_DAYS,
    createdAt: now,
    productionId: opts.productionId,
    castId: opts.castId,
  });
  await db.update(productionCast).set({ repInviteId: inviteId }).where(eq(productionCast.id, opts.castId));

  const { subject, html } = castRepInviteEmail({
    recipientEmail: email, productionName: production.name, companyName,
    actorName: cast.actorName ?? undefined, characterName: cast.characterName ?? undefined,
    signupUrl: `${opts.baseUrl}/signup?invite=${inviteId}`, rosterUrl, existing: false,
  });
  await sendEmail({ to: email, subject, html }).catch(() => {});
  return { ok: true, mode: "invited", message: `Invited ${email} (expires in 7 days).` };
}
