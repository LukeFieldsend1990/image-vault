/**
 * Access-lifecycle status badge. The brand reserves three functional colours
 * for where a likeness sits in its lifecycle (see docs/brand-refresh-spec.md §5):
 *
 *   active   — olive  — consent live / licence in force
 *   expiring — ochre  — approaching the end date
 *   revoked  — brick  — access closed
 *   purged   — brick on tint — data destroyed post-expiry
 *   neutral  — slate  — informational, no lifecycle weight
 *
 * Tint background, small caps, soft corner — quiet until it needs to flag.
 */

export type StatusKind =
  | "active"
  | "expiring"
  | "revoked"
  | "purged"
  | "neutral";

const STATUS_STYLE: Record<StatusKind, { bg: string; color: string }> = {
  active: { bg: "var(--color-active-tint)", color: "#4f5836" },
  expiring: { bg: "var(--color-expiring-tint)", color: "#8a6122" },
  revoked: { bg: "var(--color-accent-tint)", color: "var(--color-accent-hover)" },
  purged: { bg: "var(--color-accent-tint)", color: "var(--color-accent-hover)" },
  neutral: { bg: "rgba(94,105,112,0.12)", color: "var(--color-slate)" },
};

export default function StatusBadge({
  kind,
  children,
  className = "",
}: {
  kind: StatusKind;
  children: React.ReactNode;
  className?: string;
}) {
  const s = STATUS_STYLE[kind];
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 align-middle ${className}`}
      style={{ background: s.bg, color: s.color, borderRadius: "var(--radius-sm)" }}
    >
      {children}
    </span>
  );
}
