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
import { getDb } from "@/lib/db";
import { emailLog } from "@/lib/db/schema";

/** The public mailbox that forwards to the team. */
export const CONTACT_ADDRESS = "contact@imagevault.ai";

/** Human inboxes that contact enquiries are delivered to. */
export const CONTACT_RECIPIENTS = [
  "lukefieldsend@googlemail.com",
  "Martin.davison@gmail.com",
];

/**
 * Sender for contact mail. Must be on a domain the Resend key is authorised to
 * send from — imagevault.ai is verified; changling.io is not (Resend rejects it
 * with a 403). Kept explicit so contact mail is unaffected by RESEND_FROM_EMAIL.
 */
export const CONTACT_FROM = "Image Vault <noreply@imagevault.ai>";

interface ForwardEnv {
  RESEND_API_KEY?: string;
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
 * Record a forward failure in the outbound email log so it surfaces in the admin
 * failure view (and is queryable), mirroring how sendEmail() logs its own
 * failures. Best-effort — a logging failure must never mask the original error.
 */
async function logForwardFailure(
  stage: "fetch" | "send",
  errorCode: number | null,
  errorBody: string
): Promise<void> {
  try {
    const db = getDb();
    await db.insert(emailLog).values({
      id: crypto.randomUUID(),
      toAddress: CONTACT_RECIPIENTS.join(", "),
      subject: `[contact-forward] ${stage} failed`,
      status: "failed",
      errorCode,
      errorBody: errorBody.slice(0, 2000),
      sentAt: Math.floor(Date.now() / 1000),
    });
  } catch {
    // Outside request context or DB unavailable — nothing more we can do.
  }
}

/**
 * Fetch the inbound message from Resend, retrying briefly on the errors that
 * mean "not persisted yet". The webhook fires the instant Resend accepts the
 * message, and this forward runs inline (not via the delayed inbound queue that
 * the alias path uses), so the message can 404 for a moment before it becomes
 * retrievable. A few short retries close that race.
 */
async function fetchInboundEmail(
  apiKey: string,
  resendEmailId: string
): Promise<
  | { ok: true; email: ResendInboundEmail }
  | { ok: false; status: number; body: string }
> {
  // Attempt immediately, then back off. Total added latency ≤ ~2.75s, all inside
  // the webhook's waitUntil so it never delays the HTTP response.
  const backoffMs = [0, 750, 2000];
  let status = 0;
  let body = "";

  for (const wait of backoffMs) {
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    // Inbound emails use /emails/receiving/{id} — not /emails/{id}.
    const res = await fetch(`https://api.resend.com/emails/receiving/${resendEmailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      return { ok: true, email: (await res.json()) as ResendInboundEmail };
    }

    status = res.status;
    body = await res.text();
    // Only 404 (not yet persisted), 429 (rate limited) and 5xx (transient) are
    // worth retrying. Anything else (401/403 auth, 400 bad id) will not recover.
    if (status !== 404 && status !== 429 && status < 500) break;
  }

  return { ok: false, status, body };
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

  const fetched = await fetchInboundEmail(apiKey, resendEmailId);
  if (!fetched.ok) {
    console.error("[contact-forward] Failed to fetch inbound email:", fetched.status, fetched.body);
    await logForwardFailure("fetch", fetched.status || null, fetched.body);
    return { ok: false, reason: "fetch_failed" };
  }
  const email = fetched.email;

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
      from: CONTACT_FROM,
      to: CONTACT_RECIPIENTS,
      reply_to: email.from,
      subject,
      html,
    }),
  });

  if (!sendRes.ok) {
    const sendBody = await sendRes.text();
    console.error("[contact-forward] Failed to send forward:", sendRes.status, sendBody);
    await logForwardFailure("send", sendRes.status, sendBody);
    return { ok: false, reason: "send_failed" };
  }

  return { ok: true };
}
