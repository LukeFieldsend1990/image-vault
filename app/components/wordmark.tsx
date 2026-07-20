/**
 * The ImageVault wordmark — the brand's one piece of iconography.
 *
 * "Image" and "Vault" are joined as a single camel-cased word, divided by the
 * gate: two equal-weight brick-red posts — the threshold every party passes
 * through, built into the name. The letters always stay in ink.
 *
 * Two variants (see docs/brand-refresh-spec.md §4):
 *   - "display"  Newsreader serif. Hero, cover, footer, large chrome.
 *   - "lock"     Tracked sans caps, 0.30em, gate between the words. Sidebar,
 *                nav, headers, UI chrome.
 *
 * Misuse rules are baked in: the wordmark can't be stretched, recoloured,
 * shadowed, rotated, closed up, or reweighted by callers — only sized and
 * given one of the supported tones.
 */

type Tone = "ink" | "paper" | "accent";

const TONE_COLOR: Record<Tone, string> = {
  ink: "var(--color-ink)",
  paper: "var(--color-bg)",
  accent: "var(--color-accent)",
};

// On a brick/accent or ink ground the gate posts read in paper so they stay
// visible; on paper they hold the brand brick red.
function gateColor(tone: Tone): string {
  return tone === "paper" || tone === "accent"
    ? "var(--color-bg)"
    : "var(--color-accent)";
}

/**
 * The gate — two thin posts between Image and Vault.
 *
 * Geometry per brand guidelines v1.0 §3: posts 0.055em wide with a 0.09em
 * inner gap, 0.72em tall, standing on the baseline with no vertical offset.
 * The side margins are optically balanced so the measured ink gap between
 * each word and its post is equal — the "e" carries more sidebearing than
 * the "V", so the left margin tucks in slightly.
 */
function Gate({ tone, gapLeft = "0.135em", gapRight = "0.15em", post = "0.055em", height = "0.72em" }: {
  tone: Tone;
  gapLeft?: string;
  gapRight?: string;
  post?: string;
  height?: string;
}) {
  const color = gateColor(tone);
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "max(1px, 0.09em)",
        margin: `0 ${gapRight} 0 ${gapLeft}`,
      }}
    >
      <span style={{ display: "inline-block", width: `max(1px, ${post})`, height, background: color }} />
      <span style={{ display: "inline-block", width: `max(1px, ${post})`, height, background: color }} />
    </span>
  );
}

export function Wordmark({
  variant = "display",
  tone = "ink",
  className = "",
  style,
}: {
  variant?: "display" | "lock";
  tone?: Tone;
  className?: string;
  style?: React.CSSProperties;
}) {
  const color = TONE_COLOR[tone];

  if (variant === "lock") {
    // Tracked-cap lockup — IMAGE ‖ VAULT in the sans, with the gate device
    // between the words so chrome headers carry the same mark as the rest
    // of the site.
    return (
      <span
        className={className}
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 600,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color,
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "baseline",
          ...style,
        }}
      >
        {/* Browsers render letter-spacing after the trailing E too; pull it
            back (plus the E's sidebearing, ~0.03em) so the measured ink gap
            sits an even 0.3em — one tracking unit — from both words. */}
        <span style={{ marginRight: "-0.33em" }}>Image</span>
        <Gate tone={tone} gapLeft="0.3em" gapRight="0.3em" />
        Vault
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{
        fontFamily: "var(--font-serif)",
        fontWeight: 600,
        letterSpacing: "-0.005em",
        color,
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "baseline",
        ...style,
      }}
    >
      Image
      <Gate tone={tone} />
      Vault
    </span>
  );
}

export default Wordmark;
