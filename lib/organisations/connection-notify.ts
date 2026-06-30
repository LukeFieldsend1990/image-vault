// Best-effort notification that an org has been offered a visibility connection.
// Emails the target org's owners/admins so they can review the request in their
// organisations view. Never throws — notification must not block the offer.

import { and, eq, inArray } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { organisationMembers, organisations, productions, users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";

type Db = ReturnType<typeof getDb>;

export async function sendConnectionOfferNotification(
  db: Db,
  input: { targetOrgId: string; initiatorOrgId: string; productionId: string },
): Promise<void> {
  try {
    const [initiator, production, recipients] = await Promise.all([
      db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, input.initiatorOrgId)).get(),
      db.select({ name: productions.name }).from(productions).where(eq(productions.id, input.productionId)).get(),
      db
        .select({ email: users.email })
        .from(organisationMembers)
        .innerJoin(users, eq(users.id, organisationMembers.userId))
        .where(and(eq(organisationMembers.organisationId, input.targetOrgId), inArray(organisationMembers.memberRole, ["owner", "admin"])))
        .all(),
    ]);

    const emails = [...new Set(recipients.map((r) => r.email))];
    if (emails.length === 0) return;

    const initiatorName = initiator?.name ?? "An organisation";
    const productionName = production?.name ?? "a production";
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";

    const subject = `${initiatorName} wants to connect on ${productionName}`;
    const html = `
      <p>${escapeHtml(initiatorName)} has asked to connect with your organisation on <strong>${escapeHtml(productionName)}</strong>.</p>
      <p>Connecting lets your organisations see each other while you work together. You choose what to share, and you can decline or disconnect at any time. Nothing about your organisation is shared until you accept.</p>
      <p><a href="${baseUrl}/organisations">Review the request</a></p>
    `;

    await sendEmail({ to: emails, subject, html });
  } catch {
    // swallow — best-effort only
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
