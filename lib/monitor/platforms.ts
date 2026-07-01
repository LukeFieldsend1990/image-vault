/**
 * Platform registry for the likeness monitor. The sweep covers every entry;
 * synthetic short-form candidates are only sourced from platforms with a
 * `contentType` (video/social surfaces where AI likeness misuse circulates).
 */

export type MonitorPlatformId =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "x"
  | "pinterest"
  | "google"
  | "getty"
  | "midjourney";

export type HitContentType = "reel" | "short" | "video" | "post";

export interface MonitorPlatform {
  id: MonitorPlatformId;
  name: string;
  category: string;
  /** Present when the platform hosts flaggable short-form content. */
  contentType?: HitContentType;
}

export const MONITOR_PLATFORMS: MonitorPlatform[] = [
  { id: "instagram", name: "Instagram Reels", category: "Video", contentType: "reel" },
  { id: "tiktok", name: "TikTok", category: "Video", contentType: "video" },
  { id: "youtube", name: "YouTube Shorts", category: "Video", contentType: "short" },
  { id: "x", name: "X (Twitter)", category: "Social", contentType: "post" },
  { id: "pinterest", name: "Pinterest", category: "Social" },
  { id: "google", name: "Google Images", category: "Search" },
  { id: "getty", name: "Getty / Shutterstock", category: "Stock" },
  { id: "midjourney", name: "AI Platforms", category: "AI Gen" },
];

export function platformName(id: string): string {
  return MONITOR_PLATFORMS.find((p) => p.id === id)?.name ?? id;
}
