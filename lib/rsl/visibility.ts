/**
 * The single public-exposure gate for RSL surfaces.
 *
 * A talent's public consent profile (/c/<slug>) and its machine-readable
 * license.xml are served ONLY when every one of these holds. Every public route
 * calls isPublic() first and 404s (not 403s) when it returns false, so we never
 * even confirm that a profile exists.
 *
 *   1. publishOptIn   — the talent asked for a public profile (key 1)
 *   2. adminApproved  — an admin approved it (key 2, the master switch)
 *   3. publicSlug     — an unguessable address has been minted
 *   4. !vaultLocked   — locking the vault immediately pulls public RSL
 *
 * See specs/RSL-CONSENT-REGISTRY-SPEC.md (Security & exposure).
 */

export interface PublicGateInput {
  publishOptIn: boolean;
  adminApproved: boolean;
  publicSlug: string | null;
  vaultLocked: boolean;
}

export function isPublic(p: PublicGateInput): boolean {
  return p.publishOptIn && p.adminApproved && !!p.publicSlug && !p.vaultLocked;
}

const SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Mint an unlisted, unguessable public slug (24 chars of base62, ~142 bits).
 * Deliberately NOT derived from the enumerable AH-/LC- codes — the URL is the
 * only thing standing between the public internet and the profile.
 */
export function generateSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let out = "";
  for (const b of bytes) out += SLUG_ALPHABET[b % 62];
  return out;
}
