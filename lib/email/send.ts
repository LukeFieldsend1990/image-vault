/**
 * Thin wrapper around the Resend REST API.
 * Works on Cloudflare edge (no Node.js runtime needed).
 *
 * Set RESEND_API_KEY in .dev.vars / Cloudflare Pages secrets.
 * Set RESEND_FROM_EMAIL to your verified sender (e.g. "Changling <noreply@changling.io>").
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { users, emailLog } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

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
    const { env, ctx } = getCloudflareContext();
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

  // Capture db once for mute filtering and failure logging
  let db: ReturnType<typeof getDb> | undefined;
  try {
    db = getDb();
  } catch {
    // Outside request context — proceed without DB
  }

  // Filter out recipients whose email is muted by an admin
  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
  if (db) {
    try {
      const rows = await db
        .select({ email: users.email, emailMuted: users.emailMuted })
        .from(users)
        .where(inArray(users.email, recipients))
        .all();
      const muted = new Set(rows.filter((r) => r.emailMuted).map((r) => r.email));
      const filtered = recipients.filter((e) => !muted.has(e));
      if (filtered.length === 0) {
        console.log("[email] All recipients muted — skipping email:", payload.subject);
        return;
      }
      payload = { ...payload, to: filtered };
    } catch {
      // If DB lookup fails, proceed with original recipients
    }
  }

  const toAddress = Array.isArray(payload.to) ? payload.to.join(", ") : payload.to;

  const logFailure = async (errorCode: number | null, errorBody: string) => {
    if (!db) return;
    try {
      await db.insert(emailLog).values({
        id: crypto.randomUUID(),
        toAddress,
        subject: payload.subject,
        status: "failed",
        errorCode,
        errorBody: errorBody.slice(0, 2000),
        sentAt: Math.floor(Date.now() / 1000),
      });
    } catch {
      // Don't let logging failure propagate
    }
  };

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
        await logFailure(res.status, body);
      }
    } catch (err) {
      console.error("[email] Fetch failed", err);
      await logFailure(null, String(err));
    }
  };

  // Use waitUntil so the worker stays alive for the fetch after the response is sent
  if (waitUntil) {
    waitUntil(doSend());
  } else {
    await doSend();
  }
}
