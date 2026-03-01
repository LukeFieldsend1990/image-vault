/**
 * Thin wrapper around the Resend REST API.
 * Works on Cloudflare edge (no Node.js runtime needed).
 *
 * Set RESEND_API_KEY in .env.local / .dev.vars / Cloudflare Pages secrets.
 * Set RESEND_FROM_EMAIL to your verified sender (e.g. "Image Vault <noreply@yourdomain.com>").
 * Falls back to onboarding@resend.dev for local dev without domain verification.
 */

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Not configured — skip silently (e.g. local dev without secrets)
    console.warn("[email] RESEND_API_KEY not set — skipping email to", payload.to);
    return;
  }

  const from =
    process.env.RESEND_FROM_EMAIL ?? "Image Vault <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(payload.to) ? payload.to : [payload.to],
      subject: payload.subject,
      html: payload.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[email] Resend error", res.status, body);
  }
}
