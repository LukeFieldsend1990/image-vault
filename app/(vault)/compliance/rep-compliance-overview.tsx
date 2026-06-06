"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FadeImage } from "@/app/(vault)/fade-image";

type ComplianceStatus = "compliant" | "partial" | "gap" | "critical";

interface TalentSummary {
  talentId: string;
  fullName: string | null;
  profileImageUrl: string | null;
  healthScore: number;
  complianceStatus: ComplianceStatus;
  totalLicences: number;
  totalProductions: number;
  requiredGapsTotal: number;
  activeStrikes: number;
  pendingTransfers: number;
  actionCount: number;
}

const STATUS_COLOR: Record<ComplianceStatus, string> = {
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
const STATUS_LABEL: Record<ComplianceStatus, string> = {
  compliant: "Compliant",
  partial: "Partial",
  gap: "Gap",
  critical: "Critical",
};

function HealthRing({ score, status }: { score: number; status: ComplianceStatus }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = STATUS_COLOR[status];
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-border)" strokeWidth="4" />
      <circle
        cx="32" cy="32" r={r} fill="none"
        stroke={color} strokeWidth="4"
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text x="32" y="36" textAnchor="middle" fontSize="11" fontWeight="600" fill={color}>{score}%</text>
    </svg>
  );
}

function TalentCard({ t }: { t: TalentSummary }) {
  const initials = (t.fullName ?? "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
  const status = t.complianceStatus;
  return (
    <Link
      href={`/roster/${t.talentId}?tab=compliance`}
      className="block rounded transition hover:opacity-90"
      style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", textDecoration: "none" }}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
            style={{ background: "var(--color-border)" }}
          >
            {t.profileImageUrl ? (
              <FadeImage
                src={t.profileImageUrl}
                alt={t.fullName ?? "Talent"}
                width={32}
                height={32}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-[10px] font-semibold" style={{ color: "var(--color-muted)" }}>{initials}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink)" }}>
              {t.fullName ?? "Unnamed Talent"}
            </p>
            <span
              className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mt-1"
              style={{ background: STATUS_BG[status], color: STATUS_COLOR[status] }}
            >
              {STATUS_LABEL[status]}
            </span>
          </div>
          <HealthRing score={t.healthScore} status={status} />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
          {[
            { label: "Licences", value: t.totalLicences },
            { label: "Productions", value: t.totalProductions },
            { label: "Gaps", value: t.requiredGapsTotal },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-base font-semibold" style={{ color: s.label === "Gaps" && s.value > 0 ? "#c0392b" : "var(--color-ink)" }}>
                {s.value}
              </p>
              <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>{s.label}</p>
            </div>
          ))}
        </div>

        {t.actionCount > 0 && (
          <p className="mt-2.5 text-[11px]" style={{ color: "#c0392b" }}>
            {t.actionCount} urgent action{t.actionCount !== 1 ? "s" : ""} required
          </p>
        )}
      </div>
      <div
        className="px-4 py-2 text-[11px] font-medium border-t flex items-center justify-between"
        style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
      >
        View compliance details
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </Link>
  );
}

export default function RepComplianceOverview() {
  const [talent, setTalent] = useState<TalentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/compliance/rep-overview")
      .then((r) => r.json())
      .then((d) => {
        const data = d as { talent?: TalentSummary[]; error?: string };
        if (data.error) setError(data.error);
        else setTalent(data.talent ?? []);
      })
      .catch(() => setError("Failed to load compliance data."))
      .finally(() => setLoading(false));
  }, []);

  // Aggregate totals
  const totalLicences = talent.reduce((a, t) => a + t.totalLicences, 0);
  const totalProductions = talent.reduce((a, t) => a + t.totalProductions, 0);
  const totalGaps = talent.reduce((a, t) => a + t.requiredGapsTotal, 0);
  const totalStrikes = talent.reduce((a, t) => a + t.activeStrikes, 0);
  const compliantCount = talent.filter((t) => t.complianceStatus === "compliant").length;
  const overallPct = talent.length > 0 ? Math.round(talent.reduce((a, t) => a + t.healthScore, 0) / talent.length) : 0;

  const sectionHeader = "text-[10px] font-semibold tracking-widest uppercase";

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <p className={sectionHeader} style={{ color: "var(--color-accent)" }}>SAG-AFTRA ARTICLE 39</p>
        <h1 className="text-2xl font-semibold tracking-tight mt-0.5" style={{ color: "var(--color-ink)" }}>
          Compliance Overview
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Compliance status across your managed talent roster.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded p-4 animate-pulse"
              style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", height: "160px" }}
            />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm" style={{ color: "#c0392b" }}>{error}</p>
      ) : talent.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No talent on your roster yet.</p>
      ) : (
        <>
          {/* Aggregate stats bar */}
          <div
            className="grid grid-cols-5 gap-px mb-8 rounded overflow-hidden"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-border)" }}
          >
            {[
              { label: "Avg. Score", value: `${overallPct}%`, highlight: overallPct === 100 },
              { label: "Talent", value: `${compliantCount}/${talent.length}`, sub: "compliant" },
              { label: "Licences", value: totalLicences },
              { label: "Productions", value: totalProductions },
              { label: "Open Gaps", value: totalGaps, danger: totalGaps > 0 },
            ].map((s) => (
              <div key={s.label} className="px-5 py-4" style={{ background: "var(--color-surface)" }}>
                <p
                  className="text-xl font-semibold"
                  style={{ color: s.danger ? "#c0392b" : s.highlight ? "#1a7f37" : "var(--color-ink)" }}
                >
                  {s.value}
                </p>
                <p className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {s.label}
                  {s.sub && <><br /><span>{s.sub}</span></>}
                </p>
              </div>
            ))}
          </div>

          {/* Talent cards */}
          <p className={`${sectionHeader} mb-3`} style={{ color: "var(--color-muted)" }}>
            Talent ({talent.length})
          </p>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {talent.map((t) => (
              <TalentCard key={t.talentId} t={t} />
            ))}
          </div>

          {totalStrikes > 0 && (
            <p className="mt-6 text-xs" style={{ color: "#c0392b" }}>
              {totalStrikes} active strike{totalStrikes !== 1 ? "s" : ""} across roster — review immediately.
            </p>
          )}
        </>
      )}
    </div>
  );
}
