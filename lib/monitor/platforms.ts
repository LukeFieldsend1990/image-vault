/**
 * Platform registry for the likeness monitor.
 *
 * Every entry now has a live discovery route (see `source`), but coverage is
 * governed per-platform by an admin toggle stored in ai_settings
 * (lib/monitor/platform-settings.ts). The original three surfaces default on;
 * the newer ones default off so enabling them is a deliberate operator action
 * while the detector is still in testing.
 */

export type MonitorPlatformId =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "x"
  | "pinterest"
  | "reddit"
  | "google"
  | "getty"
  | "midjourney";

export type HitContentType = "reel" | "short" | "video" | "post" | "image";

/** Where a platform's live candidates come from. */
export type DiscoverySourceKind = "apify" | "youtube_api" | "civitai";

export interface MonitorPlatform {
  id: MonitorPlatformId;
  name: string;
  category: string;
  /** The flaggable content type this platform predominantly hosts. */
  contentType: HitContentType;
  /** Live discovery route. Determines which credential the platform needs. */
  source: DiscoverySourceKind;
  /** Enabled state used when no ai_settings row exists for the platform. */
  defaultEnabled: boolean;
}

export const MONITOR_PLATFORMS: MonitorPlatform[] = [
  { id: "instagram", name: "Instagram Reels", category: "Video", contentType: "reel", source: "apify", defaultEnabled: true },
  { id: "tiktok", name: "TikTok", category: "Video", contentType: "video", source: "apify", defaultEnabled: true },
  { id: "youtube", name: "YouTube Shorts", category: "Video", contentType: "short", source: "youtube_api", defaultEnabled: true },
  { id: "x", name: "X (Twitter)", category: "Social", contentType: "post", source: "apify", defaultEnabled: false },
  { id: "pinterest", name: "Pinterest", category: "Social", contentType: "post", source: "apify", defaultEnabled: false },
  { id: "reddit", name: "Reddit", category: "Social", contentType: "post", source: "apify", defaultEnabled: false },
  { id: "google", name: "Google Images", category: "Search", contentType: "image", source: "apify", defaultEnabled: false },
  { id: "getty", name: "Getty / Shutterstock", category: "Stock", contentType: "image", source: "apify", defaultEnabled: false },
  { id: "midjourney", name: "AI Platforms", category: "AI Gen", contentType: "image", source: "civitai", defaultEnabled: false },
];

export function platformName(id: string): string {
  return MONITOR_PLATFORMS.find((p) => p.id === id)?.name ?? id;
}

export function isMonitorPlatformId(id: string): id is MonitorPlatformId {
  return MONITOR_PLATFORMS.some((p) => p.id === id);
}
