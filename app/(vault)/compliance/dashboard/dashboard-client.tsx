"use client";

import { useEffect, useState } from "react";
import type { DashboardData, ActionItem, ProductionCompliance, ObligationSummaryItem } from "@/lib/compliance/dashboard";

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
        {assessed > 0 ? `${item.metCount}/${assessed}` : "—"}
      </span>
      <span
        className="text-[10px] uppercase tracking-widest w-20 text-right shrink-0 font-medium"
        style={{ color }}
      >
        {pct === 100 ? "✓ Met" : hasGap ? `⚠ ${item.gapCount} gap${item.gapCount > 1 ? "s" : ""}` : "—"}
      </span>
    </div>
  );
}

function ProductionCard({ prod }: { prod: ProductionCompliance }) {
  const color = STATUS_COLORS[prod.complianceStatus];
  const bg = STATUS_BG[prod.complianceStatus];
  const circ = 2 * Math.PI * 18;
  const offset = circ * (1 - prod.healthScore / 100);

  return (
    <div
      className="rounded p-4 flex flex-col gap-3"
      style={{ border: `1px solid ${color}22`, background: "var(--color-surface)" }}
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

      <div className="flex items-center gap-3">
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--color-border)" strokeWidth="5" />
          <circle
            cx="22"
            cy="22"
            r="18"
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 22 22)"
          />
          <text x="22" y="26" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--color-text)">
            {prod.healthScore}%
          </text>
        </svg>
        <div className="flex-1 space-y-1">
          {prod.obligations
            .filter((o) => o.severity === "required" && o.status !== "n/a")
            .slice(0, 3)
            .map((o) => (
              <div key={o.id} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
                <span style={{ color: o.status === "met" ? STATUS_COLORS.compliant : STATUS_COLORS.gap }}>
                  {o.status === "met" ? "✓" : "⚠"}
                </span>
                <span className="truncate">{o.clauseRef} {o.title}</span>
              </div>
            ))}
          {prod.requiredGaps > 0 && (
            <p className="text-xs font-medium" style={{ color: STATUS_COLORS.gap }}>
              {prod.requiredGaps} required gap{prod.requiredGaps !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionRow({ item }: { item: ActionItem }) {
  const urgColor = URGENCY_COLORS[item.urgency];

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
          {item.urgency}
        </span>
        {item.deadlineLabel && (
          <span className="text-[10px]" style={{ color: urgColor }}>
            {item.deadlineLabel}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
          {item.action}
        </p>
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
  const [showAllActions, setShowAllActions] = useState(false);

  useEffect(() => {
    fetch("/api/compliance/dashboard")
      .then((r) => r.json())
      .then((raw) => {
        const d = raw as DashboardData | { error: string };
        if ("error" in d) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Failed to load compliance data."))
      .finally(() => setLoading(false));
  }, []);

  async function generateCertificate() {
    if (!data) return;
    setGeneratingCert(true);
    try {
      const res = await fetch("/api/compliance/certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "organisation", scopeId: data.orgId, regime: data.regime }),
      });
      if (res.ok) {
        const cert = (await res.json()) as { id: string; url: string };
        window.open(cert.url, "_blank");
        // Refresh to show new cert
        const refreshed = await fetch("/api/compliance/dashboard").then((r) => r.json()) as DashboardData;
        setData(refreshed);
      }
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
            {REGIME_LABELS[data.regime] ?? data.regime} · {data.orgName}
          </p>
        </div>
        <button
          onClick={generateCertificate}
          disabled={generatingCert}
          className="text-xs px-4 py-2 rounded disabled:opacity-50"
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          {generatingCert ? "Generating…" : "Generate Certificate"}
        </button>
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
              <ProductionCard key={prod.id ?? i} prod={prod} />
            ))}
          </div>
        </section>
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
