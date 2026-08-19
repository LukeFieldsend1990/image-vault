/**
 * Per-platform visual accents for monitor hit and account cards.
 *
 * The cards stay ImageVault — paper surface, ink type, standard borders — and
 * each platform contributes exactly two touches of its own design language: a
 * thin accent edge on the card (gradient where the brand is a gradient) and a
 * tinted chip behind the platform icon/label. Enough to read the platform at a
 * glance without turning the vault into a brand mood-board.
 *
 * Colour literals by design, same as lib/documents/palette.ts: these are the
 * platforms' colours, not ours, and must not follow the app theme.
 */

export interface PlatformBrand {
  /** Signature colour — icon tint, chip text. */
  color: string;
  /** CSS background for the card's accent edge. Gradients for gradient brands. */
  edge: string;
  /** Soft wash behind the icon/label chip. */
  tint: string;
}

const FALLBACK: PlatformBrand = {
  color: "var(--color-muted)",
  edge: "var(--color-border)",
  tint: "var(--color-surface)",
};

export const PLATFORM_BRANDS: Record<string, PlatformBrand> = {
  instagram: {
    color: "#dd2a7b",
    edge: "linear-gradient(180deg, #f58529 0%, #dd2a7b 55%, #8134af 100%)",
    tint: "rgba(221, 42, 123, 0.10)",
  },
  tiktok: {
    color: "#fe2c55",
    edge: "linear-gradient(180deg, #25f4ee 0%, #fe2c55 100%)",
    tint: "rgba(254, 44, 85, 0.09)",
  },
  youtube: {
    color: "#ff0000",
    edge: "#ff0000",
    tint: "rgba(255, 0, 0, 0.08)",
  },
  x: {
    color: "#0f1419",
    edge: "#0f1419",
    tint: "rgba(15, 20, 25, 0.08)",
  },
  pinterest: {
    color: "#e60023",
    edge: "#e60023",
    tint: "rgba(230, 0, 35, 0.08)",
  },
  reddit: {
    color: "#ff4500",
    edge: "#ff4500",
    tint: "rgba(255, 69, 0, 0.08)",
  },
  google: {
    color: "#4285f4",
    edge: "linear-gradient(180deg, #4285f4 0%, #34a853 40%, #fbbc05 70%, #ea4335 100%)",
    tint: "rgba(66, 133, 244, 0.09)",
  },
  // Getty's black folding into Shutterstock's red — the two libraries the
  // surface actually sweeps.
  getty: {
    color: "#1a1a1a",
    edge: "linear-gradient(180deg, #1a1a1a 0%, #ee2b24 100%)",
    tint: "rgba(26, 26, 26, 0.07)",
  },
  // "AI Platforms" has no single brand; violet-into-blue is the genre's.
  midjourney: {
    color: "#6d28d9",
    edge: "linear-gradient(180deg, #7c3aed 0%, #2563eb 100%)",
    tint: "rgba(109, 40, 217, 0.09)",
  },
};

export function platformBrand(id: string): PlatformBrand {
  return PLATFORM_BRANDS[id] ?? FALLBACK;
}
