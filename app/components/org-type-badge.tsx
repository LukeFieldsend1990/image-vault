import { ORG_TYPE_LABELS, ORG_TYPE_SHORT_LABELS, isOrgType, type OrgType } from "@/lib/organisations/orgTypes";

/**
 * Compact, consistent badge for an organisation's subtype. Use anywhere an org
 * name is shown so the reader can tell a VFX vendor from a production company
 * from a scan service at a glance.
 */

const ORG_TYPE_COLORS: Record<OrgType, { bg: string; color: string }> = {
  production_company: { bg: "rgba(94,106,114,0.14)", color: "#47535b" },
  studio: { bg: "rgba(94,106,114,0.14)", color: "#47535b" },
  vfx_vendor: { bg: "rgba(124,138,87,0.16)", color: "#5d6b3a" },
  dubbing: { bg: "rgba(154,122,46,0.16)", color: "#8a6e29" },
  scan_service: { bg: "rgba(176,113,74,0.16)", color: "#9c5e38" },
  advertising_agency: { bg: "rgba(110,108,98,0.12)", color: "#6E6C62" },
  brand: { bg: "rgba(110,108,98,0.12)", color: "#6E6C62" },
  publisher: { bg: "rgba(110,108,98,0.12)", color: "#6E6C62" },
  game_studio: { bg: "rgba(110,108,98,0.12)", color: "#6E6C62" },
  ai_company: { bg: "rgba(192,57,43,0.10)", color: "#C0392B" },
  broadcaster: { bg: "rgba(110,108,98,0.12)", color: "#6E6C62" },
  other: { bg: "var(--color-border)", color: "var(--color-muted)" },
};

export default function OrgTypeBadge({
  type,
  long = false,
  className = "",
}: {
  type: string | null | undefined;
  long?: boolean;
  className?: string;
}) {
  if (!isOrgType(type)) return null;
  const c = ORG_TYPE_COLORS[type];
  const label = long ? ORG_TYPE_LABELS[type] : ORG_TYPE_SHORT_LABELS[type];
  return (
    <span
      className={`inline-block shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded align-middle ${className}`}
      style={{ background: c.bg, color: c.color }}
      title={ORG_TYPE_LABELS[type]}
    >
      {label}
    </span>
  );
}
