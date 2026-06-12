/**
 * Env-explicit Resend sender for plain Cloudflare Workers.
 *
 * lib/email/send.ts depends on getRequestContext() (next-on-pages) with a
 * process.env fallback — both unavailable in satellite workers like ai-worker.
 * This variant takes the worker's env bindings directly. Same Resend call,
 * same skip-and-warn behaviour when the key is missing.
 */

import { users } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export async function sendEmailDirect(
  env: { RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string },
  payload: { to: string[]; subject: string; html: string },
  opts?: { db?: Db; waitUntil?: (p: Promise<unknown>) => void }
): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM_EMAIL ?? "Changling <noreply@changling.io>";

  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping email to", payload.to);
    return;
  }

  // Honour the emailMuted flag when a db handle is provided
  let to = payload.to;
  if (opts?.db) {
    try {
      const rows = await opts.db
        .select({ email: users.email, emailMuted: users.emailMuted })
        .from(users)
        .where(inArray(users.email, to))
        .all();
      const muted = new Set(rows.filter((r) => r.emailMuted).map((r) => r.email));
      to = to.filter((e) => !muted.has(e));
      if (to.length === 0) {
        console.log("[email] All recipients muted — skipping email:", payload.subject);
        return;
      }
    } catch {
      // If the lookup fails, proceed with the original recipients
    }
  }

  const doSend = async () => {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to, subject: payload.subject, html: payload.html }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error("[email] Resend error", res.status, body);
      }
    } catch (err) {
      console.error("[email] Fetch failed", err);
    }
  };

  if (opts?.waitUntil) {
    opts.waitUntil(doSend());
  } else {
    await doSend();
  }
}
