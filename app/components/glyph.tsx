/**
 * Brand glyph set — the geometric marks from the guidelines (the gate, scan,
 * monitor, time, consent). These carry *meaning*: they mark domain concepts at
 * semantic moments (access, lifecycle, the record). They are deliberately NOT a
 * general icon library — utility chrome (sort, trash, +, eye) stays as quiet
 * thin strokes so the meaningful marks never have to compete with plumbing.
 *
 * One geometric language: 24×24, stroke-based, round joins, no fill.
 */

export type GlyphName =
  | "gate"     // access — the two posts a party passes through
  | "scan"     // the likeness scan — framed sensor dot
  | "monitor"  // active watch — concentric target
  | "time"     // time-bound / expiry
  | "consent"; // consent bound / approved

const PATHS: Record<GlyphName, React.ReactNode> = {
  gate: (
    <>
      <line x1="9" y1="4" x2="9" y2="20" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </>
  ),
  scan: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  monitor: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  time: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <polyline points="12 7 12 12 15.5 13.8" />
    </>
  ),
  consent: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <polyline points="8 12 11 15 16 9" />
    </>
  ),
};

export default function Glyph({
  name,
  size = 16,
  strokeWidth = 1.75,
  className = "",
  style,
}: {
  name: GlyphName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
