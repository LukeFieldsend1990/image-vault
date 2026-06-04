"use client";

import { useEffect, useState } from "react";
import type { DashboardData, ActionItem, ProductionCompliance, ObligationSummaryItem, LicenceSummary } from "@/lib/compliance/dashboard";

interface OrgOption {
  id: string;
  name: string;
  memberRole: string;
}

function OrgSwitcher({
  orgs,
  selectedId,
  onSelect,
}: {
  orgs: OrgOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = orgs.find((o) => o.id === selectedId) ?? orgs[0];
  if (!selected || orgs.length < 2) return null;

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "none",
          border: "none",
          color: "var(--color-accent)",
          fontSize: "inherit",
          letterSpacing: "inherit",
          textTransform: "inherit",
          fontWeight: "inherit",
          cursor: "pointer",
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        {selected.name.toUpperCase()}
        <svg width="7" height="4" viewBox="0 0 7 4" fill="currentColor" style={{ opacity: 0.8 }}>
          <path d="M0 0l3.5 4L7 0H0z" />
        </svg>
      </button>

      {open && (
        <>
          {/* click-outside overlay */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 9 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              minWidth: "180px",
              zIndex: 10,
              overflow: "hidden",
              boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            }}
          >
            {orgs.map((o) => (
              <button
                key={o.id}
                onClick={() => { onSelect(o.id); setOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  textAlign: "left",
                  background: o.id === selectedId ? "var(--color-border)" : "transparent",
                  border: "none",
                  color: "var(--color-text)",
                  fontSize: "13px",
                  padding: "9px 14px",
                  cursor: "pointer",
                  gap: "8px",
                }}
              >
                <span>{o.name}</span>
                {o.id === selectedId && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

// ── colour helpers ────────────────────────────────────────────────────────────

type ComplianceStatus = "compliant" | "partial" | "gap" | "critical";

const STATUS_COLORS: Record<ComplianceStatus, string> = {
  compliant: "#1a7f37",
  partial: "#b45309",
  gap: "#c0392b",
  critical: "#7f1d1d",
};

const STATUS_BG: Record<ComplianceStatus, string> = {
  compliant: "rgba(26,127,55,0.08)",
  partial: "rgba(180,83,9,0.08)",
  gap: "rgba(192,57,43,0.08)",
  critical: "rgba(127,29,29,0.12)",
};

const STATUS_LABELS: Record<ComplianceStatus, string> = {
  compliant: "Compliant",
  partial: "Partial",
  gap: "Gap",
  critical: "Critical",
};

const URGENCY_COLORS: Record<string, string> = {
  critical: "#c0392b",
  soon: "#b45309",
  upcoming: "#7c6d0a",
  info: "var(--color-muted)",
  pending: "#2563eb",  // blue — obligation exists but clock hasn't started
};

const URGENCY_LABELS: Record<string, string> = {
  critical: "Critical",
  soon: "Soon",
  upcoming: "Upcoming",
  info: "Info",
  pending: "Pending",
};

// ── sub-components ────────────────────────────────────────────────────────────

function HealthRing({ score, status }: { score: number; status: ComplianceStatus }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = STATUS_COLORS[status];

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--color-border)" strokeWidth="8" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 64 64)"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <text x="64" y="60" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--color-text)">
          {score}%
        </text>
        <text x="64" y="78" textAnchor="middle" fontSize="10" fill={color} style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {STATUS_LABELS[status]}
        </text>
      </svg>
    </div>
  );
}

function StatCard({ value, label, warn }: { value: number | string; label: string; warn?: boolean }) {
  return (
    <div
      className="rounded p-4 flex flex-col gap-1 min-w-[100px]"
      style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
    >
      <span
        className="text-2xl font-semibold tabular-nums"
        style={{ color: warn && Number(value) > 0 ? "var(--color-accent)" : "var(--color-text)" }}
      >
        {value}
      </span>
      <span className="text-xs tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
        {label}
      </span>
    </div>
  );
}

function ObligationBar({ item }: { item: ObligationSummaryItem }) {
  const assessed = item.metCount + item.gapCount;
  const pct = item.progressPct;
  const hasGap = item.gapCount > 0;
  const hasPending = (item.pendingCount ?? 0) > 0;
  const color = item.severity === "required"
    ? (hasGap ? STATUS_COLORS.gap : STATUS_COLORS.compliant)
    : (hasGap ? "#b45309" : STATUS_COLORS.compliant);

  return (
    <div className="flex items-center gap-4 py-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
      <span
        className="text-xs font-mono w-12 shrink-0"
        style={{ color: "var(--color-muted)" }}
      >
        {item.clauseRef}
      </span>
      <span className="text-sm flex-1 min-w-0 truncate" style={{ color: "var(--color-text)" }}>
        {item.title}
      </span>
      <div className="w-32 shrink-0">
        <div
          className="h-1.5 rounded-full overflow-hidden"
          style={{ background: "var(--color-border)" }}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, background: color, transition: "width 0.5s ease" }}
          />
        </div>
      </div>
      <span className="text-xs tabular-nums w-16 text-right shrink-0" style={{ color: "var(--color-muted)" }}>
        {assessed > 0 ? `${item.metCount}/${assessed}` : hasPending ? "—" : "—"}
      </span>
      <span
        className="text-[10px] uppercase tracking-widest w-24 text-right shrink-0 font-medium"
        style={{ color: hasGap ? color : hasPending ? URGENCY_COLORS.pending : color }}
      >
        {hasGap
          ? `⚠ ${item.gapCount} gap${item.gapCount > 1 ? "s" : ""}`
          : hasPending
          ? `⏳ ${item.pendingCount} pending`
          : pct === 100
          ? "✓ Met"
          : "—"}
      </span>
    </div>
  );
}

// ── Production detail modal ───────────────────────────────────────────────────

const OBL_STATUS_ICON: Record<string, string> = { met: "✓", gap: "⚠", pending: "⏳", "n/a": "—" };
const OBL_STATUS_COLOR: Record<string, string> = {
  met: "#1a7f37", gap: "#c0392b", pending: "#2563eb", "n/a": "#aaa",
};
const OBL_PROOF: Record<string, string> = {
  met: "Evidence on ledger",
  gap: "No satisfying event recorded",
  pending: "Required on licence expiry",
  "n/a": "Not applicable to this licence",
};

function ProductionModal({
  prod,
  onClose,
}: {
  prod: ProductionCompliance;
  onClose: () => void;
}) {
  const color = STATUS_COLORS[prod.complianceStatus];

  return (
    <>
      {/* backdrop */}
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 40 }}
        onClick={onClose}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: "min(92vw, 700px)",
          maxHeight: "85vh",
          overflowY: "auto",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "10px",
          zIndex: 41,
          padding: "24px",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
              {prod.name}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              {prod.type ?? "Production"} · {prod.licenceCount} licence{prod.licenceCount !== 1 ? "s" : ""}
              {" · "}
              <span style={{ color, fontWeight: 600 }}>
                {prod.healthScore}% {STATUS_LABELS[prod.complianceStatus]}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-muted)",
              cursor: "pointer",
              fontSize: "20px",
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        {/* Per-licence breakdown */}
        <div className="space-y-5">
          {prod.licences.map((lic) => (
            <LicenceObligationPanel key={lic.id} lic={lic} />
          ))}
        </div>
      </div>
    </>
  );
}

function LicenceObligationPanel({ lic }: { lic: LicenceSummary }) {
  const type = lic.licenceType?.replace(/_/g, " ") ?? "—";
  const gaps = lic.obligations.filter((o) => o.severity === "required" && o.status === "gap").length;

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "6px",
        overflow: "hidden",
      }}
    >
      {/* Licence header */}
      <div
        className="flex items-center justify-between px-3 py-2 gap-3"
        style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-bg)" }}
      >
        <div>
          <span className="text-xs font-mono" style={{ color: "var(--color-muted)" }}>
            {lic.id.slice(0, 8)}
          </span>
          <span className="text-xs ml-2" style={{ color: "var(--color-text)" }}>
            {lic.projectName}
          </span>
          <span className="text-xs ml-2" style={{ color: "var(--color-muted)" }}>
            · {type} · {lic.status}
          </span>
        </div>
        {gaps > 0 && (
          <span className="text-[10px] font-medium" style={{ color: STATUS_COLORS.gap }}>
            {gaps} gap{gaps !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Obligation rows */}
      <div>
        {lic.obligations.filter((o) => o.status !== "n/a").map((o) => {
          const ic = OBL_STATUS_COLOR[o.status] ?? "#aaa";
          return (
            <div
              key={o.id}
              className="flex items-start gap-3 px-3 py-2"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <span className="text-sm mt-0.5 shrink-0 w-4 text-center" style={{ color: ic }}>
                {OBL_STATUS_ICON[o.status] ?? "—"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
                  <span className="font-mono mr-1.5" style={{ color: "var(--color-muted)" }}>{o.clauseRef}</span>
                  {o.title}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: ic, opacity: 0.85 }}>
                  {OBL_PROOF[o.status] ?? o.status}
                </p>
              </div>
              <span className="text-[10px] uppercase tracking-widest shrink-0" style={{ color: "var(--color-muted)" }}>
                {o.severity}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProductionCard({
  prod,
  onClick,
}: {
  prod: ProductionCompliance;
  onClick: () => void;
}) {
  const color = STATUS_COLORS[prod.complianceStatus];
  const bg = STATUS_BG[prod.complianceStatus];
  const circ = 2 * Math.PI * 22;
  const offset = circ * (1 - prod.healthScore / 100);

  return (
    <button
      onClick={onClick}
      className="rounded p-4 flex flex-col gap-3 w-full text-left"
      style={{
        border: `1px solid ${color}33`,
        background: "var(--color-surface)",
        cursor: "pointer",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate text-sm" style={{ color: "var(--color-text)" }}>
            {prod.name}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
            {prod.type ?? "Production"} · {prod.licenceCount} licence{prod.licenceCount !== 1 ? "s" : ""}
          </p>
        </div>
        <span
          className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded shrink-0"
          style={{ background: bg, color, border: `1px solid ${color}44` }}
        >
          {STATUS_LABELS[prod.complianceStatus]}
        </span>
      </div>

      {/* Health score — prominent % with ring */}
      <div className="flex items-center gap-4">
        <div className="relative flex items-center justify-center shrink-0">
          <svg width="56" height="56" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="22" fill="none" stroke="var(--color-border)" strokeWidth="5" />
            <circle
              cx="28" cy="28" r="22"
              fill="none"
              stroke={color}
              strokeWidth="5"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 28 28)"
            />
          </svg>
          <span
            style={{
              position: "absolute",
              fontSize: "13px",
              fontWeight: 700,
              color,
              lineHeight: 1,
            }}
          >
            {prod.healthScore}%
          </span>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          {prod.obligations
            .filter((o) => o.severity === "required" && o.status !== "n/a")
            .slice(0, 4)
            .map((o) => {
              const iconColor =
                o.status === "met" ? STATUS_COLORS.compliant :
                o.status === "pending" ? URGENCY_COLORS.pending :
                STATUS_COLORS.gap;
              const icon = o.status === "met" ? "✓" : o.status === "pending" ? "⏳" : "⚠";
              return (
                <div key={o.id} className="flex items-center gap-1.5 text-xs overflow-hidden" style={{ color: "var(--color-muted)" }}>
                  <span className="shrink-0" style={{ color: iconColor }}>{icon}</span>
                  <span className="truncate">{o.clauseRef} {o.title}</span>
                </div>
              );
            })}
          {prod.requiredGaps > 0 && (
            <p className="text-xs font-medium" style={{ color: STATUS_COLORS.gap }}>
              {prod.requiredGaps} required gap{prod.requiredGaps !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-muted)", opacity: 0.7 }}>
        Click for details →
      </p>
    </button>
  );
}

// Map obligation IDs to direct action URLs (producer-owned obligations only).
// Talent-owned obligations (39.B, 39.D) have no licensee-accessible page.
const ACTION_LINKS: Record<string, (licenceId: string) => string> = {
  "platform-scrub-attestation": (id) => `/licences/${id}/scrub`,
  "sag-39-e-biometric-isolation": (id) => `/licences/${id}`,
  "sag-39-h-security-custody": (id) => `/licences/${id}`,
  "sag-39-i-transfer-approval": (id) => `/licences/${id}`,
  "sag-39-j-business-reason": (id) => `/licences/${id}`,
};

function ActionRow({ item }: { item: ActionItem }) {
  const urgColor = URGENCY_COLORS[item.urgency];
  const linkFn = ACTION_LINKS[item.obligationId];
  const href = linkFn ? linkFn(item.licenceId) : null;

  return (
    <div
      className="flex items-start gap-4 py-3"
      style={{ borderBottom: "1px solid var(--color-border)" }}
    >
      <div className="flex flex-col items-center gap-0.5 shrink-0 w-20">
        <span
          className="text-[10px] uppercase tracking-widest font-semibold"
          style={{ color: urgColor }}
        >
          {URGENCY_LABELS[item.urgency] ?? item.urgency}
        </span>
        {item.deadlineLabel && (
          <span className="text-[10px]" style={{ color: urgColor }}>
            {item.deadlineLabel}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {href ? (
          <a
            href={href}
            className="text-sm font-medium hover:underline"
            style={{ color: "var(--color-text)" }}
          >
            {item.action} →
          </a>
        ) : (
          <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            {item.action}
          </p>
        )}
        <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
          {item.productionName} · {item.clauseRef} ·{" "}
          <span style={{ color: urgColor === "var(--color-muted)" ? "var(--color-muted)" : urgColor }}>
            {item.actionOwner}
          </span>
        </p>
      </div>
      <span
        className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded shrink-0"
        style={{
          color: item.severity === "required" ? "var(--color-accent)" : "var(--color-muted)",
          border: "1px solid var(--color-border)",
        }}
      >
        {item.severity}
      </span>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

const REGIME_LABELS: Record<string, string> = {
  sag_aftra: "SAG-AFTRA Article 39 · 2026 TV/Theatrical AI",
  equity: "Equity — Digital Replica",
  gdpr: "GDPR — Biometric Data",
  bipa: "BIPA — Illinois Biometric",
};

export default function ComplianceDashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatingCert, setGeneratingCert] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);
  const [showAllActions, setShowAllActions] = useState(false);
  const [modalProd, setModalProd] = useState<ProductionCompliance | null>(null);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  // Load user's org list on mount — populates the switcher
  useEffect(() => {
    fetch("/api/organisations")
      .then((r) => r.json())
      .then((raw) => {
        const r = raw as { organisations?: OrgOption[] };
        setOrgs(r.organisations ?? []);
      })
      .catch(() => {/* switcher simply won't render */});
  }, []);

  // Re-fetch dashboard whenever the selected org changes (null = API auto-resolves)
  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = selectedOrgId
      ? `/api/compliance/dashboard?orgId=${encodeURIComponent(selectedOrgId)}`
      : "/api/compliance/dashboard";
    fetch(url)
      .then((r) => r.json())
      .then((raw) => {
        const d = raw as DashboardData | { error: string };
        if ("error" in d) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Failed to load compliance data."))
      .finally(() => setLoading(false));
  }, [selectedOrgId]);

  async function generateCertificate() {
    if (!data) return;
    setCertError(null);
    setGeneratingCert(true);

    // Open the window NOW while we're still inside the user gesture — browsers
    // block window.open() called after an async gap (popup blocker).
    const certWindow = window.open("", "_blank");

    try {
      const res = await fetch("/api/compliance/certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "organisation", scopeId: data.orgId, regime: data.regime }),
      });
      const json = await res.json() as { id?: string; url?: string; error?: string };
      if (!res.ok || json.error) {
        certWindow?.close();
        setCertError(json.error ?? `Generation failed (${res.status})`);
        return;
      }
      if (certWindow && json.url) {
        certWindow.location.href = json.url;
      }
      // Refresh dashboard to show the new cert in the vault
      const refreshUrl = selectedOrgId
        ? `/api/compliance/dashboard?orgId=${encodeURIComponent(selectedOrgId)}`
        : "/api/compliance/dashboard";
      const refreshed = await fetch(refreshUrl).then((r) => r.json()) as DashboardData;
      setData(refreshed);
    } catch (e) {
      certWindow?.close();
      setCertError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setGeneratingCert(false);
    }
  }

  const sectionHeader = "text-xs font-medium tracking-widest uppercase";
  const card = "rounded p-4";
  const cardStyle = {
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Loading compliance data…
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <p className="text-sm" style={{ color: "var(--color-accent)" }}>
          {error ?? "No compliance data available. Ensure your organisation has active licences."}
        </p>
      </div>
    );
  }

  const visibleActions = showAllActions ? data.actionItems : data.actionItems.slice(0, 8);
  const criticalCount = data.actionItems.filter((a) => a.urgency === "critical").length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
            Compliance Control Centre
          </h1>
          <p className="text-xs mt-1 tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
            {REGIME_LABELS[data.regime] ?? data.regime}
            {" · "}
            {orgs.length > 1 ? (
              <OrgSwitcher
                orgs={orgs}
                selectedId={selectedOrgId ?? data.orgId}
                onSelect={(id) => { setSelectedOrgId(id); setShowAllActions(false); }}
              />
            ) : (
              data.orgName
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={generateCertificate}
            disabled={generatingCert}
            className="text-xs px-4 py-2 rounded disabled:opacity-50"
            style={{ background: "var(--color-accent)", color: "#fff" }}
          >
            {generatingCert ? "Generating…" : "Generate Certificate"}
          </button>
          {certError && (
            <p className="text-xs" style={{ color: "var(--color-accent)" }}>
              {certError}
            </p>
          )}
        </div>
      </header>

      {/* Health score + stat cards */}
      <div className={`${card} flex flex-wrap items-center gap-8`} style={cardStyle}>
        <HealthRing score={data.healthScore} status={data.complianceStatus} />
        <div className="flex flex-wrap gap-4">
          <StatCard value={data.summary.totalLicences} label="Licences" />
          <StatCard
            value={`${data.summary.compliantProductions}/${data.summary.totalProductions}`}
            label="Productions"
          />
          <StatCard value={data.summary.requiredGapsTotal} label="Required Gaps" warn />
          <StatCard value={data.summary.activeStrikes} label="Active Strikes" warn />
          <StatCard value={data.summary.pendingTransfers} label="Pending Transfers" warn />
        </div>
        {criticalCount > 0 && (
          <div
            className="rounded px-3 py-2 text-xs"
            style={{
              background: "rgba(192,57,43,0.08)",
              border: "1px solid rgba(192,57,43,0.3)",
              color: STATUS_COLORS.gap,
            }}
          >
            {criticalCount} critical action{criticalCount !== 1 ? "s" : ""} require immediate attention
          </div>
        )}
      </div>

      {/* Obligation progress */}
      {data.obligationSummary.length > 0 && (
        <section className={card} style={cardStyle}>
          <p className={`${sectionHeader} mb-4`} style={{ color: "var(--color-muted)" }}>
            Obligation Progress
          </p>
          <div>
            {data.obligationSummary.map((item) => (
              <ObligationBar key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Productions grid */}
      {data.productions.length > 0 && (
        <section>
          <p className={`${sectionHeader} mb-3`} style={{ color: "var(--color-muted)" }}>
            Productions ({data.productions.length})
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.productions.map((prod, i) => (
              <ProductionCard key={prod.id ?? i} prod={prod} onClick={() => setModalProd(prod)} />
            ))}
          </div>
        </section>
      )}

      {/* Production detail modal */}
      {modalProd && (
        <ProductionModal prod={modalProd} onClose={() => setModalProd(null)} />
      )}

      {/* Action queue */}
      {data.actionItems.length > 0 ? (
        <section className={card} style={cardStyle}>
          <div className="flex items-center justify-between mb-2">
            <p className={sectionHeader} style={{ color: "var(--color-muted)" }}>
              Action Queue ({data.actionItems.length})
            </p>
            {data.actionItems.length > 8 && (
              <button
                onClick={() => setShowAllActions((v) => !v)}
                className="text-xs"
                style={{ color: "var(--color-accent)" }}
              >
                {showAllActions ? "Show fewer" : `Show all ${data.actionItems.length}`}
              </button>
            )}
          </div>
          <div>
            {visibleActions.map((item, i) => (
              <ActionRow key={`${item.licenceId}-${item.obligationId}-${i}`} item={item} />
            ))}
          </div>
        </section>
      ) : (
        <div className={card} style={cardStyle}>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            No open action items — all obligations are met or not applicable.
          </p>
        </div>
      )}

      {/* Certificate vault */}
      {data.recentCertificates.length > 0 && (
        <section>
          <p className={`${sectionHeader} mb-3`} style={{ color: "var(--color-muted)" }}>
            Recent Certificates
          </p>
          <div className="space-y-2">
            {data.recentCertificates.map((cert) => (
              <a
                key={cert.id}
                href={`/api/compliance/certificates/${cert.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`${card} flex items-center justify-between`}
                style={{ ...cardStyle, textDecoration: "none" }}
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                    {cert.scope.charAt(0).toUpperCase() + cert.scope.slice(1)} certificate
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {new Date(cert.generatedAt * 1000).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <span className="text-xs" style={{ color: "var(--color-accent)" }}>
                  View →
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
