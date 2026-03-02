/**
 * Thin wrapper around the Resend REST API.
 * Works on Cloudflare edge (no Node.js runtime needed).
 *
 * Set RESEND_API_KEY in .dev.vars / Cloudflare Pages secrets.
 * Set RESEND_FROM_EMAIL to your verified sender (e.g. "Changling <noreply@changling.io>").
 */

import { getRequestContext } from "@cloudflare/next-on-pages";

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  // On Cloudflare Pages, secrets/vars live in the request context env, not process.env
  let apiKey: string | undefined;
  let from: string;
  let waitUntil: ((p: Promise<unknown>) => void) | undefined;

  try {
    const { env, ctx } = getRequestContext();
    const e = env as unknown as Record<string, string | undefined>;
    apiKey = e.RESEND_API_KEY;
    from = e.RESEND_FROM_EMAIL ?? "Changling <noreply@changling.io>";
    waitUntil = ctx.waitUntil.bind(ctx);
  } catch {
    // Local dev — fall back to process.env
    apiKey = process.env.RESEND_API_KEY;
    from = process.env.RESEND_FROM_EMAIL ?? "Changling <noreply@changling.io>";
  }

  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping email to", payload.to);
    return;
  }

  const doSend = async () => {
    try {
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
    } catch (err) {
      console.error("[email] Fetch failed", err);
    }
  };

  // Use waitUntil so the worker stays alive for the fetch after the response is sent
  if (waitUntil) {
    waitUntil(doSend());
  } else {
    await doSend();
  }
}
