/**
 * Inbound forwarding for the public contact mailbox.
 *
 * Resend receives mail for imagevault.ai and posts an `email.received` webhook
 * (handled in app/api/webhooks/resend/route.ts). For mail addressed to
 * CONTACT_ADDRESS we fetch the full message from Resend and re-send it to the
 * team inboxes, with Reply-To set to the original sender so replies go straight
 * back to them.
 *
 * This is the inbound counterpart to the /contact form: the form delivers
 * enquiries via /api/contact, this delivers mail sent directly to the address.
 * Both use CONTACT_RECIPIENTS so there is a single source of truth.
 */

import { contactForwardEmail } from "@/lib/email/templates";

/** The public mailbox that forwards to the team. */
export const CONTACT_ADDRESS = "contact@imagevault.ai";

/** Human inboxes that contact enquiries are delivered to. */
export const CONTACT_RECIPIENTS = [
  "lukefieldsend@googlemail.com",
  "Martin.davison@gmail.com",
];

interface ForwardEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

interface ResendInboundEmail {
  from: string;
  subject?: string;
  text?: string;
  html?: string;
}

/** Extract the bare email address from a `Name <email>` or plain string. */
function extractEmail(addr: string): string {
  const match = addr.match(/<([^>]+)>/);
  return (match ? match[1] : addr).toLowerCase().trim();
}

/** True if any recipient is the public contact address. */
export function isContactRecipient(addresses: string[]): boolean {
  return addresses.some((a) => extractEmail(a) === CONTACT_ADDRESS);
}

/** Minimal HTML→text fallback for when an inbound email has no text part. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Fetch the full inbound message from Resend and forward it to the team.
 * Returns a small result object for logging; never throws for expected failures.
 */
export async function forwardContactEmail(
  env: ForwardEnv,
  resendEmailId: string
): Promise<{ ok: boolean; reason?: string }> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[contact-forward] RESEND_API_KEY not set — skipping forward");
    return { ok: false, reason: "no_api_key" };
  }

  // Inbound emails use /emails/receiving/{id} — not /emails/{id}.
  const res = await fetch(`https://api.resend.com/emails/receiving/${resendEmailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error("[contact-forward] Failed to fetch inbound email:", res.status, await res.text());
    return { ok: false, reason: "fetch_failed" };
  }
  const email = (await res.json()) as ResendInboundEmail;

  const body = email.text?.trim()
    || (email.html ? htmlToText(email.html) : "")
    || "(no message body)";

  const { subject, html } = contactForwardEmail({
    fromAddress: email.from,
    subject: email.subject,
    body,
    receivedAt: Math.floor(Date.now() / 1000),
  });

  const sendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL ?? "Changling <noreply@changling.io>",
      to: CONTACT_RECIPIENTS,
      reply_to: email.from,
      subject,
      html,
    }),
  });

  if (!sendRes.ok) {
    console.error("[contact-forward] Failed to send forward:", sendRes.status, await sendRes.text());
    return { ok: false, reason: "send_failed" };
  }

  return { ok: true };
}
