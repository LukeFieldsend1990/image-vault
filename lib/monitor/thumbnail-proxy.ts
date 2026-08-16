/**
 * Guard for the hit-thumbnail proxy (app/api/monitor/hits/[id]/thumbnail).
 *
 * Thumbnail URLs are written by the discovery ingesters from whatever the
 * platform API returned, so by the time the proxy fetches one it is
 * third-party input the Worker is about to make an outbound request with.
 * Kept pure and separate from the route so the URL rules can be tested
 * directly.
 */

/** Cap on proxied thumbnail size — same ceiling the sweep's image fetch uses. */
export const MAX_THUMBNAIL_BYTES = 5_000_000;

/** Outbound fetch timeout, matching lib/monitor/identity-check.ts. */
export const THUMBNAIL_TIMEOUT_MS = 8_000;

/**
 * Parse a stored thumbnail URL, returning it only if it is safe to fetch:
 * HTTPS, and a real CDN hostname rather than an IP literal or a local name.
 * Everything else returns null and the proxy answers 404.
 */
export function isFetchableThumbnailUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();
  if (!host) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
  // IPv4 literals and bracketed IPv6 — no legitimate CDN thumbnail arrives as
  // one, and they are the shape an SSRF attempt would take (169.254.169.254,
  // 127.0.0.1, private ranges).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return null;

  return url;
}
