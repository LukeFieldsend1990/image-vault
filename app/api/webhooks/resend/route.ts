export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { inboundAliases, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { INBOUND_DOMAIN } from "@/lib/inbound/alias";

/**
 * Verify Resend webhook signature using svix.
 */
async function verifyWebhookSignature(
  payload: string,
  headers: {
    svixId: string | null;
    svixTimestamp: string | null;
    svixSignature: string | null;
  },
  secret: string
): Promise<boolean> {
  if (!headers.svixId || !headers.svixTimestamp || !headers.svixSignature) {
    return false;
  }

  const ts = parseInt(headers.svixTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) return false;

  const toSign = `${headers.svixId}.${headers.svixTimestamp}.${payload}`;
  const secretBytes = Uint8Array.from(
    atob(secret.startsWith("whsec_") ? secret.slice(6) : secret),
    (c) => c.charCodeAt(0)
  );

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(toSign));
  const computed = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));

  const signatures = headers.svixSignature.split(" ");
  return signatures.some((sig) => {
    const [version, hash] = sig.split(",");
    return version === "v1" && hash === computed;
  });
}

function findAlias(addresses: string[]): string | null {
  for (const addr of addresses) {
    const lower = addr.toLowerCase().trim();
    if (lower.endsWith(`@${INBOUND_DOMAIN}`)) {
      return lower.split("@")[0];
    }
  }
  return null;
}

// POST /api/webhooks/resend — thin handler: verify, resolve, enqueue
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // 1. Verify webhook signature
  let webhookSecret: string | undefined;
  let queue: { send(body: unknown): Promise<void> } | undefined;
  try {
    const { env } = getRequestContext();
    const e = env as unknown as Record<string, unknown>;
    webhookSecret = e.RESEND_WEBHOOK_SECRET as string | undefined;
    queue = e.INBOUND_QUEUE as typeof queue;
  } catch {
    webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  }

  if (webhookSecret) {
    const valid = await verifyWebhookSignature(rawBody, {
      svixId: req.headers.get("svix-id"),
      svixTimestamp: req.headers.get("svix-timestamp"),
      svixSignature: req.headers.get("svix-signature"),
    }, webhookSecret);

    if (!valid) {
      console.error("[webhook] Invalid Resend webhook signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // 2. Parse event
  let event: {
    type: string;
    data: {
      email_id?: string;
      to?: string[];
      cc?: string[];
      from?: string;
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 3. Only process email.received events
  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true });
  }

  const resendEmailId = event.data.email_id;
  if (!resendEmailId) {
    return NextResponse.json({ error: "Missing email_id" }, { status: 400 });
  }

  // 4. Idempotency check via KV
  const kv = getKv();
  const dedupeKey = `inbound:${resendEmailId}`;
  const existing = await kv.get(dedupeKey);
  if (existing) {
    return NextResponse.json({ ok: true, deduplicated: true });
  }
  await kv.put(dedupeKey, "processing", { expirationTtl: 86400 });

  // 5. Resolve alias from recipients
  const allRecipients = [...(event.data.to ?? []), ...(event.data.cc ?? [])];
  const aliasLocal = findAlias(allRecipients);

  if (!aliasLocal) {
    console.warn("[webhook] No matching alias found in recipients:", allRecipients);
    return NextResponse.json({ ok: true, routed: false });
  }

  // 6. Look up alias in DB
  const db = getDb();
  const alias = await db
    .select()
    .from(inboundAliases)
    .where(and(eq(inboundAliases.alias, aliasLocal), eq(inboundAliases.status, "active")))
    .get();

  if (!alias) {
    console.warn("[webhook] Alias not found or revoked:", aliasLocal);
    return NextResponse.json({ ok: true, routed: false });
  }

  // 7. Check user has inbound enabled
  const user = await db
    .select({ inboundEnabled: users.inboundEnabled })
    .from(users)
    .where(eq(users.id, alias.ownerUserId))
    .get();

  if (!user?.inboundEnabled) {
    console.warn("[webhook] Inbound disabled for user:", alias.ownerUserId);
    return NextResponse.json({ ok: true, routed: false, reason: "feature_disabled" });
  }

  // 8. Enqueue to comms worker (worker fetches full email via Resend API)
  if (queue) {
    await queue.send({
      resendEmailId,
      aliasId: alias.id,
      ownerUserId: alias.ownerUserId,
      ownerEntityId: alias.ownerEntityId,
    });
  } else {
    console.warn("[webhook] INBOUND_QUEUE not available — message not processed");
  }

  return NextResponse.json({ ok: true, routed: true });
}
