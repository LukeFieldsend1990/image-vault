/**
 * Hit thumbnails: fetching them, keeping them, and the rules for both.
 *
 * Platform CDN URLs are signed and short-lived — a preview that loaded
 * yesterday is a 403 today — so the bytes are captured into R2 at discovery
 * time and served from there (app/api/monitor/hits/[id]/thumbnail). The live
 * URL is only ever a fallback for hits captured before this existed.
 *
 * Thumbnail URLs are written by the discovery ingesters from whatever the
 * platform API returned, so fetching one is an outbound request built from
 * third-party input. The URL guard below is pure and separately tested for
 * exactly that reason.
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

/** R2 key for a hit's captured preview. */
export function thumbnailKeyFor(hitId: string): string {
  return `monitor/thumbnails/${hitId}`;
}

export interface FetchedThumbnail {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Download a thumbnail, enforcing every rule the proxy would: safe URL, image
 * content type, size cap, timeout. Returns null on any failure — an expired
 * signature, a deleted post, a CDN that refuses us — because there is nothing
 * a caller can do about it beyond showing the placeholder.
 */
export async function fetchThumbnail(rawUrl: string): Promise<FetchedThumbnail | null> {
  const url = isFetchableThumbnailUrl(rawUrl);
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), THUMBNAIL_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "image/*",
        // Some CDNs refuse an empty User-Agent outright. Identify honestly
        // rather than impersonating a browser.
        "user-agent": "ImageVaultMonitor/1.0 (+https://imagevault.ai)",
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_THUMBNAIL_BYTES) return null;
    return { bytes, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Persist bytes already in hand. Returns the R2 key. */
export async function storeThumbnail(
  bucket: R2Bucket,
  hitId: string,
  thumb: FetchedThumbnail
): Promise<string> {
  const key = thumbnailKeyFor(hitId);
  await bucket.put(key, thumb.bytes, { httpMetadata: { contentType: thumb.contentType } });
  return key;
}

/** Fetch and persist a hit's preview. Returns the R2 key, or null if the
 *  platform would not give us the bytes. */
export async function captureThumbnail(
  bucket: R2Bucket,
  hitId: string,
  rawUrl: string
): Promise<string | null> {
  const thumb = await fetchThumbnail(rawUrl);
  if (!thumb) return null;
  return storeThumbnail(bucket, hitId, thumb);
}
