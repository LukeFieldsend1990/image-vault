/**
 * Open License Protocol (OLP) core — the engine behind Image Vault as an RSL
 * License Server (https://rslstandard.org/api). OLP is an OAuth 2.0 extension:
 * machine clients acquire RSL licenses as bearer credentials via a token
 * endpoint with grant_type=rsl. This module is transport-agnostic; the routes
 * under app/api/rsl/olp/ wire it to HTTP.
 *
 * Consent is never bypassed: the decision for a usage comes straight from the
 * talent's posture (lib/rsl/posture.ts) — red denies, green auto-grants
 * (standing instruction = always), amber routes to a human. The license token
 * attests granted CONSENT; metered billing runs through royalty_sources.
 */

import { eq, and, desc } from "drizzle-orm";
import { rslLicenseRequests } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import { getKv } from "@/lib/db";
import { sha256Hex } from "@/lib/auth/requireRoyaltySource";
import { RSL_USAGE_MAP, RSL_PAYMENT_TYPE, type Posture } from "./posture";

type Db = ReturnType<typeof getDb>;

export const OLP_GRANT_TYPE = "rsl";
export const LICENSE_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year
/** Raw token handed back once for an async (amber) grant; picked up via poll. */
const DELIVERY_PREFIX = "rsl_license_delivery:";
const DELIVERY_TTL = 60 * 60; // 1 hour to collect the minted token

/** Reverse of RSL_USAGE_MAP: usage token → useCategoryId (live categories only). */
export const USAGE_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(RSL_USAGE_MAP).filter(([, u]) => u !== null).map(([cat, u]) => [u as string, cat]),
);

export const SUPPORTED_USAGES = Object.keys(USAGE_TO_CATEGORY); // ["ai-train", "ai-use"]

export type OlpDecision =
  | { kind: "invalid" }
  | { kind: "denied"; categoryId: string }
  | { kind: "auto_grant"; categoryId: string }
  | { kind: "review"; categoryId: string };

/** Decide what to do with a usage request given a derived posture. */
export function decideForUsage(posture: Posture, usage: string): OlpDecision {
  const categoryId = USAGE_TO_CATEGORY[usage];
  if (!categoryId) return { kind: "invalid" };
  const cat = posture.categories.find((c) => c.id === categoryId);
  if (!cat) return { kind: "invalid" };
  if (cat.light === "red") return { kind: "denied", categoryId };
  if (cat.light === "green") return { kind: "auto_grant", categoryId };
  return { kind: "review", categoryId };
}

/** The payment terms an offer carries for a usage (no fabricated amount). */
export function offerForUsage(usage: string, contentUrl: string) {
  return {
    payment_type: RSL_PAYMENT_TYPE[usage] ?? "inference",
    terms_url: contentUrl,
    note: "A licence and fee are established through Image Vault on the rights-holder's terms.",
  };
}

const TOK_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function generateLicenseToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  let s = "";
  for (const b of bytes) s += TOK_ALPHABET[b % 62];
  return `rsl_${s}`;
}

/** Extract a profile slug from a raw slug or a /c/<slug> or license.xml URL. */
export function parseResourceToSlug(resource: string | null | undefined): string | null {
  if (!resource || typeof resource !== "string") return null;
  const r = resource.trim();
  if (!r) return null;
  // license.xml URL → /api/rsl/<slug>/license.xml
  const lic = r.match(/\/api\/rsl\/([^/]+)\/license\.xml/);
  if (lic) return lic[1];
  // consent page URL → /c/<slug>
  const cp = r.match(/\/c\/([^/?#]+)/);
  if (cp) return cp[1];
  // otherwise treat as a bare slug if it has no path/scheme
  if (!r.includes("/") && !r.includes(":")) return r;
  return null;
}

export type RslLicenseRequest = typeof rslLicenseRequests.$inferSelect;

export interface CreateRequestInput {
  talentId: string;
  usage: string;
  categoryId: string;
  postureLight: "amber" | "green";
  clientId?: string | null;
  clientName?: string | null;
  contactEmail?: string | null;
  intendedUse?: string | null;
}

/** Reuse an open pending request for the same client+usage, else null. */
export async function findOpenRequest(
  db: Db,
  talentId: string,
  usage: string,
  clientId: string | null | undefined,
): Promise<RslLicenseRequest | undefined> {
  if (!clientId) return undefined;
  return db
    .select()
    .from(rslLicenseRequests)
    .where(
      and(
        eq(rslLicenseRequests.talentId, talentId),
        eq(rslLicenseRequests.usage, usage),
        eq(rslLicenseRequests.clientId, clientId),
        eq(rslLicenseRequests.status, "pending_review"),
      ),
    )
    .orderBy(desc(rslLicenseRequests.createdAt))
    .get();
}

export async function createRequest(db: Db, input: CreateRequestInput): Promise<RslLicenseRequest> {
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await db.insert(rslLicenseRequests).values({
    id,
    talentId: input.talentId,
    usage: input.usage,
    useCategoryId: input.categoryId,
    postureLight: input.postureLight,
    clientId: input.clientId ?? null,
    clientName: input.clientName ?? null,
    contactEmail: input.contactEmail ?? null,
    intendedUse: input.intendedUse ?? null,
    status: "pending_review",
    createdAt: now,
    updatedAt: now,
  });
  return (await db.select().from(rslLicenseRequests).where(eq(rslLicenseRequests.id, id)).get())!;
}

export interface Grant {
  rawToken: string;
  expiresAt: number;
}

/**
 * Mint a license token for a request and mark it granted. Returns the raw token
 * (shown once). For human-approved (amber) grants the caller stashes the raw
 * token in KV via storeDelivery() so the client can collect it on its next poll.
 */
export async function grantRequest(
  db: Db,
  requestId: string,
  decidedBy: string | null,
): Promise<Grant> {
  const rawToken = generateLicenseToken();
  const hash = await sha256Hex(rawToken);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + LICENSE_TTL_SECONDS;
  await db
    .update(rslLicenseRequests)
    .set({
      status: "granted",
      decidedBy: decidedBy,
      decidedAt: now,
      licenseTokenHash: hash,
      licenseExpiresAt: expiresAt,
      updatedAt: now,
    })
    .where(eq(rslLicenseRequests.id, requestId));
  return { rawToken, expiresAt };
}

export async function denyRequest(db: Db, requestId: string, decidedBy: string | null): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(rslLicenseRequests)
    .set({ status: "denied", decidedBy, decidedAt: now, updatedAt: now })
    .where(eq(rslLicenseRequests.id, requestId));
}

/** Stash a minted token for one-time pickup by the polling client. */
export async function storeDelivery(requestId: string, rawToken: string): Promise<void> {
  try {
    await getKv().put(`${DELIVERY_PREFIX}${requestId}`, rawToken, { expirationTtl: DELIVERY_TTL });
  } catch {
    // best-effort; introspection still works once the client has the token
  }
}

/** Collect-and-delete a stashed token (returned once after an async grant). */
export async function collectDelivery(requestId: string): Promise<string | null> {
  try {
    const kv = getKv();
    const token = await kv.get(`${DELIVERY_PREFIX}${requestId}`);
    if (token) await kv.delete(`${DELIVERY_PREFIX}${requestId}`);
    return token;
  } catch {
    return null;
  }
}

export interface Introspection {
  active: boolean;
  usage?: string;
  content?: string; // slug
  talentId?: string;
  exp?: number;
}

/** OAuth2-style token introspection for a license token. */
export async function introspect(db: Db, rawToken: string): Promise<Introspection> {
  if (!rawToken || !rawToken.startsWith("rsl_")) return { active: false };
  const hash = await sha256Hex(rawToken);
  const row = await db
    .select()
    .from(rslLicenseRequests)
    .where(eq(rslLicenseRequests.licenseTokenHash, hash))
    .get();
  if (!row || row.status !== "granted") return { active: false };
  const now = Math.floor(Date.now() / 1000);
  if (row.licenseExpiresAt && row.licenseExpiresAt < now) return { active: false };
  return {
    active: true,
    usage: row.usage,
    talentId: row.talentId,
    exp: row.licenseExpiresAt ?? undefined,
  };
}
