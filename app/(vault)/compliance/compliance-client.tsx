"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  DashboardData,
  ActionItem,
  ProductionCompliance,
  ObligationSummaryItem,
  LicenceSummary,
  ObligationResultWithEvidence,
} from "@/lib/compliance/dashboard";

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
  pending: "#2563eb",
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
          cx="64" cy="64" r={r}
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
      <span className="text-xs font-mono w-12 shrink-0" style={{ color: "var(--color-muted)" }}>
        {item.clauseRef}
      </span>
      <span className="text-sm flex-1 min-w-0 truncate" style={{ color: "var(--color-text)" }}>
        {item.title}
      </span>
      <div className="w-32 shrink-0">
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
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

// ── Production card ───────────────────────────────────────────────────────────

function ProductionCard({ prod, onClick }: { prod: ProductionCompliance; onClick: () => void }) {
  const color = STATUS_COLORS[prod.complianceStatus];
  const bg = STATUS_BG[prod.complianceStatus];
  const circ = 2 * Math.PI * 22;
  const offset = circ * (1 - prod.healthScore / 100);

  return (
    <button
      onClick={onClick}
      className="rounded p-4 flex flex-col gap-3 w-full text-left"
      style={{ border: `1px solid ${color}33`, background: "var(--color-surface)", cursor: "pointer" }}
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
          <span style={{ position: "absolute", fontSize: "13px", fontWeight: 700, color, lineHeight: 1 }}>
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
        Click to manage consents →
      </p>
    </button>
  );
}

// ── Obligation evidence detail ────────────────────────────────────────────────

const OBL_STATUS_ICON: Record<string, string> = { met: "✓", gap: "⚠", pending: "⏳", "n/a": "—" };
const OBL_STATUS_COLOR: Record<string, string> = {
  met: "#1a7f37", gap: "#c0392b", pending: "#2563eb", "n/a": "#aaa",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  "consent.granted": "Consent granted",
  "consent.dub_language_granted": "Dubbing consent granted",
  "biometric.isolation_attested": "Biometric isolation attested",
  "security.custody_attested": "Security custody attested",
  "business_reason.recorded": "Business reason recorded",
  "use.metered": "Use metered",
  "transfer.approved": "Transfer approved",
  "training.notice_filed": "Training notice filed",
  "replica.scrub_attested": "Scrub / deletion attested",
};

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatScope(scope: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof scope.useType === "string") parts.push(`use type: ${scope.useType.replace(/_/g, " ")}`);
  if (typeof scope.territory === "string") parts.push(`territory: ${scope.territory}`);
  if (typeof scope.language === "string") parts.push(`language: ${scope.language}`);
  if (scope.scriptedAlterations === true) parts.push("scripted alterations: yes");
  return parts.join("  ·  ");
}

function ObligationEvidenceDetail({ o }: { o: ObligationResultWithEvidence }) {
  const ic = OBL_STATUS_COLOR[o.status] ?? "#aaa";

  if (o.status === "met" && o.evidence) {
    const ev = o.evidence;
    const label = EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType.replace(/[._]/g, " ");
    const scopeStr = formatScope(ev.scope);
    return (
      <div style={{ marginTop: "3px" }}>
        <span className="font-mono text-[10px]" style={{ color: ic }}>{label}</span>
        <span className="text-[10px]" style={{ color: "#999" }}>
          {" "}· seq {ev.seq} · {fmtDate(ev.createdAt)} · <code style={{ fontFamily: "ui-monospace,monospace" }}>{ev.hash.slice(0, 12)}…</code>
        </span>
        {scopeStr && <p className="text-[10px] mt-0.5" style={{ color: "#aaa" }}>{scopeStr}</p>}
      </div>
    );
  }

  if (o.status === "gap") {
    const needed = o.satisfiedBy.map((t) => EVENT_TYPE_LABELS[t] ?? t.replace(/[._]/g, " ")).join(" or ");
    return (
      <div style={{ marginTop: "3px" }}>
        <span className="text-[10px]" style={{ color: ic }}>Requires: <em>{needed}</em></span>
        <span className="text-[10px]" style={{ color: "#aaa" }}> — no matching event in ledger chain</span>
      </div>
    );
  }

  if (o.status === "pending") {
    return <p className="text-[10px] mt-0.5" style={{ color: ic }}>Not yet required — obligation triggered on licence expiry</p>;
  }

  return null;
}

function LicenceObligationPanel({ lic }: { lic: LicenceSummary }) {
  const type = lic.licenceType?.replace(/_/g, " ") ?? "—";
  const gaps = lic.obligations.filter((o) => o.severity === "required" && o.status === "gap").length;

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "6px", overflow: "hidden" }}>
      <div
        className="flex items-center justify-between px-3 py-2 gap-3"
        style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-bg)" }}
      >
        <div>
          <span className="text-xs font-mono" style={{ color: "var(--color-muted)" }}>{lic.id.slice(0, 8)}</span>
          <span className="text-xs ml-2" style={{ color: "var(--color-text)" }}>{lic.projectName}</span>
          <span className="text-xs ml-2" style={{ color: "var(--color-muted)" }}>· {type} · {lic.status}</span>
        </div>
        {gaps > 0 && (
          <span className="text-[10px] font-medium" style={{ color: STATUS_COLORS.gap }}>
            {gaps} gap{gaps !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div>
        {lic.obligations.filter((o) => o.status !== "n/a").map((o) => {
          const ic = OBL_STATUS_COLOR[o.status] ?? "#aaa";
          return (
            <div key={o.id} className="flex items-start gap-3 px-3 py-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <span className="text-sm mt-0.5 shrink-0 w-4 text-center" style={{ color: ic }}>
                {OBL_STATUS_ICON[o.status] ?? "—"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
                  <span className="font-mono mr-1.5" style={{ color: "var(--color-muted)" }}>{o.clauseRef}</span>
                  {o.title}
                </p>
                <ObligationEvidenceDetail o={o} />
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

// ── Consent management panel ──────────────────────────────────────────────────

const TERRITORY_OPTIONS = [
  "Worldwide",
  "United Kingdom",
  "United States",
  "European Union",
  "North America",
  "Asia Pacific",
  "Other",
];

interface ConsentRecord {
  id: string;
  useType: string;
  territory: string | null;
  language: string | null;
  status: "granted" | "revoked" | "expired";
}

function LicenceConsentSection({ licenceId, licenceType }: { licenceId: string; licenceType: string | null }) {
  const [records, setRecords] = useState<ConsentRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({
    useType: licenceType ?? "",
    territory: "Worldwide",
    language: "",
    scriptedAlterations: false,
  });

  const loadRecords = useCallback(async () => {
    const res = await fetch(`/api/compliance/consent?licenceId=${encodeURIComponent(licenceId)}`);
    if (res.ok) {
      const data = (await res.json()) as { records: ConsentRecord[] };
      setRecords(data.records);
    }
    setLoaded(true);
  }, [licenceId]);

  useEffect(() => { void loadRecords(); }, [loadRecords]);

  async function grant() {
    setBusy("grant");
    try {
      await fetch("/api/compliance/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licenceId,
          useType: form.useType || licenceType || "commercial",
          territory: form.territory,
          language: form.language || undefined,
          scriptedAlterations: form.scriptedAlterations,
        }),
      });
      await loadRecords();
    } finally {
      setBusy(null);
    }
  }

  async function revoke(recordId: string) {
    setBusy(recordId);
    try {
      await fetch("/api/compliance/consent", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId }),
      });
      await loadRecords();
    } finally {
      setBusy(null);
    }
  }

  const inputCls = "text-sm rounded px-2 py-1";
  const inputStyle = {
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
  };

  if (!loaded) {
    return <p className="text-xs px-3 py-2" style={{ color: "var(--color-muted)" }}>Loading consents…</p>;
  }

  return (
    <div className="px-3 py-3 space-y-3">
      {records.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>No consent recorded yet.</p>
      ) : (
        <ul className="space-y-1">
          {records.map((c) => (
            <li key={c.id} className="flex items-center justify-between text-sm py-1" style={{ color: "var(--color-text)" }}>
              <span className="text-xs">
                {c.useType.replace(/_/g, " ")}
                {c.language ? ` · dub: ${c.language}` : ""}
                {c.territory ? ` · ${c.territory}` : ""}
              </span>
              <span className="flex items-center gap-3">
                <span
                  className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded"
                  style={{
                    color: c.status === "granted" ? "#1a7f37" : "var(--color-muted)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  {c.status}
                </span>
                {c.status === "granted" && (
                  <button
                    onClick={() => void revoke(c.id)}
                    disabled={busy === c.id}
                    className="text-xs underline disabled:opacity-50"
                    style={{ color: "var(--color-accent)" }}
                  >
                    Revoke
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
        <p className="text-[10px] uppercase tracking-widest font-medium mb-2" style={{ color: "var(--color-muted)" }}>
          Grant additional consent
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={inputCls}
            style={inputStyle}
            placeholder={licenceType ?? "use type"}
            value={form.useType}
            onChange={(e) => setForm({ ...form, useType: e.target.value })}
          />
          <select
            className={inputCls}
            style={{ ...inputStyle, appearance: "auto" }}
            value={form.territory}
            onChange={(e) => setForm({ ...form, territory: e.target.value })}
          >
            {TERRITORY_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            className={inputCls}
            style={inputStyle}
            placeholder="dub language (optional)"
            value={form.language}
            onChange={(e) => setForm({ ...form, language: e.target.value })}
          />
          <label className="flex items-center gap-1 text-xs" style={{ color: "var(--color-muted)" }}>
            <input
              type="checkbox"
              checked={form.scriptedAlterations}
              onChange={(e) => setForm({ ...form, scriptedAlterations: e.target.checked })}
            />
            scripted alterations
          </label>
          <button
            onClick={() => void grant()}
            disabled={busy === "grant"}
            className="text-xs px-3 py-1 rounded disabled:opacity-50"
            style={{ background: "var(--color-accent)", color: "#fff" }}
          >
            {busy === "grant" ? "Saving…" : "Grant"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Production detail modal ───────────────────────────────────────────────────

function ProductionModal({
  prod,
  talentId,
  regime,
  onClose,
}: {
  prod: ProductionCompliance;
  talentId: string;
  regime: string;
  onClose: () => void;
}) {
  const color = STATUS_COLORS[prod.complianceStatus];
  const [certBusy, setCertBusy] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"obligations" | "consents">("obligations");

  async function generateCert() {
    setCertError(null);
    setCertBusy(true);
    const win = window.open("", "_blank");
    try {
      const res = await fetch("/api/compliance/certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "talent", scopeId: talentId, regime }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || json.error) {
        win?.close();
        setCertError(json.error ?? `Failed (${res.status})`);
      } else if (win && json.url) {
        win.location.href = json.url;
      }
    } catch (e) {
      win?.close();
      setCertError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setCertBusy(false);
    }
  }

  const tabStyle = (active: boolean) => ({
    background: "none",
    border: "none",
    borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
    color: active ? "var(--color-text)" : "var(--color-muted)",
    fontSize: "12px",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    padding: "6px 12px",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
  });

  return (
    <>
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
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
              {prod.name}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              {prod.type ?? "Production"} · {prod.licenceCount} licence{prod.licenceCount !== 1 ? "s" : ""}
              {prod.sagProjectNumber && ` · SAG ${prod.sagProjectNumber}`}
              {" · "}
              <span style={{ color, fontWeight: 600 }}>
                {prod.healthScore}% {STATUS_LABELS[prod.complianceStatus]}
              </span>
            </p>
            {certError && <p className="text-xs mt-1" style={{ color: "var(--color-accent)" }}>{certError}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void generateCert()}
              disabled={certBusy}
              className="text-xs px-3 py-1.5 rounded disabled:opacity-50"
              style={{ background: "var(--color-accent)", color: "#fff" }}
            >
              {certBusy ? "Generating…" : "Certificate"}
            </button>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: "20px", lineHeight: 1, padding: "0 4px" }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 mb-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <button style={tabStyle(activeTab === "obligations")} onClick={() => setActiveTab("obligations")}>
            Obligations
          </button>
          <button style={tabStyle(activeTab === "consents")} onClick={() => setActiveTab("consents")}>
            Consents
          </button>
        </div>

        {activeTab === "obligations" && (
          <div className="space-y-5">
            {prod.licences.map((lic) => (
              <LicenceObligationPanel key={lic.id} lic={lic} />
            ))}
          </div>
        )}

        {activeTab === "consents" && (
          <div className="space-y-4">
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              Each consent is a signed, time-stamped entry in your compliance ledger (SAG-AFTRA Article 39.B / 39.D).
            </p>
            {prod.licences.map((lic) => (
              <div key={lic.id} style={{ border: "1px solid var(--color-border)", borderRadius: "6px", overflow: "hidden" }}>
                <div
                  className="px-3 py-2 flex items-center gap-2"
                  style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-bg)" }}
                >
                  <span className="text-xs font-mono" style={{ color: "var(--color-muted)" }}>{lic.id.slice(0, 8)}</span>
                  <span className="text-xs" style={{ color: "var(--color-text)" }}>{lic.projectName}</span>
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                    · {lic.licenceType?.replace(/_/g, " ") ?? "—"} · {lic.status}
                  </span>
                </div>
                <LicenceConsentSection licenceId={lic.id} licenceType={lic.licenceType} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Action row ────────────────────────────────────────────────────────────────

const ACTION_LINKS: Record<string, (licenceId: string) => string> = {
  "platform-scrub-attestation": (id) => `/licences/${id}/scrub`,
};

function ActionRow({ item }: { item: ActionItem }) {
  const urgColor = URGENCY_COLORS[item.urgency];
  const isMyAction = item.actionOwner === "talent";
  const linkFn = ACTION_LINKS[item.obligationId];
  const href = linkFn ? linkFn(item.licenceId) : null;

  return (
    <div
      className="flex items-start gap-4 py-3"
      style={{
        borderBottom: "1px solid var(--color-border)",
        background: isMyAction ? "rgba(192,57,43,0.03)" : undefined,
      }}
    >
      <div className="flex flex-col items-center gap-0.5 shrink-0 w-20">
        <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: urgColor }}>
          {URGENCY_LABELS[item.urgency] ?? item.urgency}
        </span>
        {item.deadlineLabel && (
          <span className="text-[10px]" style={{ color: urgColor }}>{item.deadlineLabel}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {href ? (
          <a href={href} className="text-sm font-medium hover:underline" style={{ color: "var(--color-text)" }}>
            {item.action} →
          </a>
        ) : (
          <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{item.action}</p>
        )}
        <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
          {item.productionName} · {item.clauseRef} ·{" "}
          <span style={{ color: isMyAction ? "var(--color-accent)" : "var(--color-muted)", fontWeight: isMyAction ? 600 : 400 }}>
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

export default function ComplianceClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatingCert, setGeneratingCert] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);
  const [showAllActions, setShowAllActions] = useState(false);
  const [modalProd, setModalProd] = useState<ProductionCompliance | null>(null);

  useEffect(() => {
    fetch("/api/compliance/talent-dashboard")
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
    setCertError(null);
    setGeneratingCert(true);
    const certWindow = window.open("", "_blank");
    try {
      const res = await fetch("/api/compliance/certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "talent", scopeId: data.orgId, regime: data.regime }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || json.error) {
        certWindow?.close();
        setCertError(json.error ?? `Generation failed (${res.status})`);
        return;
      }
      if (certWindow && json.url) certWindow.location.href = json.url;
      const refreshed = await fetch("/api/compliance/talent-dashboard").then((r) => r.json()) as DashboardData;
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
  const cardStyle = { border: "1px solid var(--color-border)", background: "var(--color-surface)" };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading compliance data…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <p className="text-sm" style={{ color: "var(--color-accent)" }}>
          {error ?? "No compliance data available. Licences appear here once granted."}
        </p>
      </div>
    );
  }

  const visibleActions = showAllActions ? data.actionItems : data.actionItems.slice(0, 8);
  const criticalCount = data.actionItems.filter((a) => a.urgency === "critical").length;
  const myActionCount = data.actionItems.filter((a) => a.actionOwner === "talent").length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
            My Compliance Dashboard
          </h1>
          <p className="text-xs mt-1 tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
            {REGIME_LABELS[data.regime] ?? data.regime}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={() => void generateCertificate()}
            disabled={generatingCert}
            className="text-xs px-4 py-2 rounded disabled:opacity-50"
            style={{ background: "var(--color-accent)", color: "#fff" }}
          >
            {generatingCert ? "Generating…" : "Generate Certificate"}
          </button>
          {certError && <p className="text-xs" style={{ color: "var(--color-accent)" }}>{certError}</p>}
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
          <StatCard value={myActionCount} label="My Actions" warn />
          <StatCard value={data.summary.pendingTransfers} label="Pending Transfers" warn />
        </div>
        {criticalCount > 0 && (
          <div
            className="rounded px-3 py-2 text-xs"
            style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.3)", color: STATUS_COLORS.gap }}
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
        <ProductionModal
          prod={modalProd}
          talentId={data.orgId}
          regime={data.regime}
          onClose={() => setModalProd(null)}
        />
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
            No open action items — all obligations are met or not yet applicable.
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
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </p>
                </div>
                <span className="text-xs" style={{ color: "var(--color-accent)" }}>View →</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
