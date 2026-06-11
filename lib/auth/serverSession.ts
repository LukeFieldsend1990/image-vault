import { cookies } from "next/headers";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { verifySessionJwt, type SessionPayload } from "./jwt";

function getJwtSecret(): string | undefined {
  try {
    return getRequestContext().env.JWT_SECRET;
  } catch {
    return process.env.JWT_SECRET;
  }
}

/**
 * Verified session for server components / pages.
 *
 * Reads the `session` cookie and validates its signature, issuer, audience and
 * expiry. Returns null when there is no cookie, the signature is invalid, or the
 * signing secret is unavailable. Never decode the JWT payload directly for
 * authorization — an unsigned token must not be trusted.
 */
export async function getServerSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) return null;
  const secret = getJwtSecret();
  if (!secret) return null;
  return verifySessionJwt(token, secret);
}
