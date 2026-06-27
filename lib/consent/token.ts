/**
 * Tokenised public consent links.
 *
 * An unregistered production-held performer is emailed a link carrying an opaque
 * token. The token resolves (server-side) to the cast row they're being asked to
 * consent for, so they can read and accept the consent document WITHOUT first
 * creating an account (forced signup kills conversion). KV-backed, multi-day TTL.
 */

import { getKv } from "@/lib/db";

const PREFIX = "consent_token:";
const CONSENT_TOKEN_TTL = 14 * 24 * 60 * 60; // 14 days

export interface ConsentTokenData {
  castId: string;
  productionId: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

/** Mint a consent token for a cast row. Returns the raw token to embed in a link. */
export async function mintConsentToken(input: {
  castId: string;
  productionId: string;
  email: string;
}): Promise<string> {
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const data: ConsentTokenData = {
    castId: input.castId,
    productionId: input.productionId,
    email: input.email,
    createdAt: now,
    expiresAt: now + CONSENT_TOKEN_TTL,
  };
  const kv = getKv();
  await kv.put(`${PREFIX}${token}`, JSON.stringify(data), { expirationTtl: CONSENT_TOKEN_TTL });
  return token;
}

/** Resolve a consent token. Returns null if missing or expired. */
export async function verifyConsentToken(token: string): Promise<ConsentTokenData | null> {
  if (!token) return null;
  const kv = getKv();
  const data = (await kv.get(`${PREFIX}${token}`, "json")) as ConsentTokenData | null;
  if (!data) return null;
  if (data.expiresAt < Math.floor(Date.now() / 1000)) return null;
  return data;
}
