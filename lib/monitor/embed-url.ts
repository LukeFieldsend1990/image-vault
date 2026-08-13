/**
 * Convert a platform content URL into its iframe-embeddable equivalent.
 *
 * Returns null when the platform blocks iframe embedding (X sets
 * X-Frame-Options: DENY on tweet pages, and their oEmbed HTML relies on
 * script execution we cannot host on a different origin without breaking
 * their referrer checks). Callers should fall back to opening the URL in
 * a new tab in that case.
 *
 * We do NOT hit any platform API — TikTok's oEmbed and Instagram's Graph
 * embed API both require credentials and both require server-side calls
 * per hit, which is a lot of latency for something the user might not
 * even click. Static URL rewrites cover the same ground for public posts
 * without a round trip.
 */

export type EmbedPlatform = "instagram" | "tiktok" | "youtube";

export interface EmbedInfo {
  platform: EmbedPlatform;
  embedUrl: string;
  /** Aspect ratio hint for the iframe — 9/16 for vertical short-form. */
  aspectRatio: "9/16" | "16/9" | "1/1";
}

export function embedInfoFor(contentUrl: string): EmbedInfo | null {
  let url: URL;
  try {
    url = new URL(contentUrl);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  // Instagram: /p/<code>/ (posts) or /reel/<code>/ (reels) — the /embed suffix
  // renders inside their standard blockquote widget and does allow iframing.
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const m = url.pathname.match(/^\/(p|reel|tv)\/([^/]+)/);
    if (!m) return null;
    return {
      platform: "instagram",
      embedUrl: `https://www.instagram.com/${m[1]}/${m[2]}/embed/`,
      aspectRatio: "9/16",
    };
  }

  // TikTok video URLs come in a few shapes. Only the numeric id matters for
  // the embed — the @handle is decorative. `/embed/v2/<id>` is the current
  // recommended path and allows iframing.
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const m =
      url.pathname.match(/\/video\/(\d+)/) ||
      url.pathname.match(/\/v\/(\d+)/) ||
      url.pathname.match(/\/@[^/]+\/photo\/(\d+)/);
    if (!m) return null;
    return {
      platform: "tiktok",
      embedUrl: `https://www.tiktok.com/embed/v2/${m[1]}`,
      aspectRatio: "9/16",
    };
  }

  // YouTube: watch?v=, /shorts/, /embed/, and youtu.be all reduce to a
  // single video id. /embed/ is the sanctioned iframe path.
  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be" ||
    host.endsWith(".youtube.com")
  ) {
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.replace(/^\//, "").split("/")[0] || null;
    else if (url.pathname.startsWith("/watch")) id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/\/(shorts|embed|v)\/([^/?]+)/);
      if (m) id = m[2];
    }
    if (!id) return null;
    return {
      platform: "youtube",
      // Shorts vertical, standard 16:9. We default to 16/9 because the
      // /embed player centers vertical content correctly, but landscape
      // uploads look worse in 9/16 than the other way round.
      embedUrl: `https://www.youtube.com/embed/${id}`,
      aspectRatio: url.pathname.includes("/shorts/") ? "9/16" : "16/9",
    };
  }

  // X (Twitter): sets X-Frame-Options: DENY on the canonical tweet URL and
  // their embed widgets require their platform.twitter.com JS running in
  // the same origin. Not embeddable.
  return null;
}
