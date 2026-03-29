"use client";

import { useEffect, useState } from "react";

type LicenceStatus = "PENDING" | "APPROVED" | "DENIED" | "REVOKED" | "EXPIRED";

interface Licence {
  id: string;
  packageName: string | null;
  projectName: string;
  productionCompany: string;
  intendedUse: string;
  validFrom: number;
  validTo: number;
  status: LicenceStatus;
  approvedAt: number | null;
  deniedAt: number | null;
  deniedReason: string | null;
  downloadCount: number;
  lastDownloadAt: number | null;
  createdAt: number;
  licenceType: string | null;
  territory: string | null;
  exclusivity: string | null;
  permitAiTraining: boolean;
  proposedFee: number | null;  // pence
  agreedFee: number | null;    // pence
  platformFee: number | null;  // pence
  agencySharePct: number | null;
  talentSharePct: number | null;
  deliveryMode: "standard" | "bridge_only" | null;
}

const STATUS_COLOURS: Record<LicenceStatus, string> = {
  PENDING: "#b45309",
  APPROVED: "#166534",
  DENIED: "#991b1b",
  REVOKED: "#6b7280",
  EXPIRED: "#6b7280",
};

const LICENCE_TYPE_LABELS: Record<string, string> = {
  film_double: "Film / Double",
  game_character: "Game Character",
  commercial: "Commercial / Advertising",
  ai_avatar: "AI Avatar / Virtual Self",
  training_data: "AI Training Data",
  monitoring_reference: "Identity / Security Reference",
};

const EXCLUSIVITY_LABELS: Record<string, string> = {
  non_exclusive: "Non-exclusive",
  sole: "Sole",
  exclusive: "Exclusive",
};

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtGBP(pence: number) {
  return `$${(pence / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

type LicenceTab = "active" | "history";

export default function TalentLicencesClient({ role = "talent" }: { role?: string }) {
  const [licences, setLicences] = useState<Licence[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [togglingDeliveryId, setTogglingDeliveryId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<LicenceTab>("active");

  async function load() {
    const r = await fetch("/api/licences");
    const d = await r.json() as { licences?: Licence[] };
    setLicences((d.licences ?? []).filter((l) => l.status !== "PENDING"));
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  async function toggleDeliveryMode(l: Licence) {
    const next = l.deliveryMode === "bridge_only" ? "standard" : "bridge_only";
    setTogglingDeliveryId(l.id);
    await fetch(`/api/licences/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryMode: next }),
    });
    setLicences((prev) => prev.map((x) => x.id === l.id ? { ...x, deliveryMode: next } : x));
    setTogglingDeliveryId(null);
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this licence? Any pending downloads will be cancelled.")) return;
    setRevokingId(id);
    await fetch(`/api/licences/${id}/revoke`, { method: "POST" });
    await load();
    setRevokingId(null);
  }

  const activeLicences = licences.filter((l) => l.status === "APPROVED");
  const historyLicences = licences.filter((l) => l.status === "DENIED" || l.status === "REVOKED" || l.status === "EXPIRED");
  const visibleLicences = activeTab === "active" ? activeLicences : historyLicences;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Granted Licences
        </h1>
      </div>

      {/* Tab bar */}
      <div className="flex border-b mb-6" style={{ borderColor: "var(--color-border)" }}>
        {([
          { id: "active" as LicenceTab, label: "Active", count: activeLicences.length },
          { id: "history" as LicenceTab, label: "Denied / Revoked", count: historyLicences.length },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="relative py-2.5 px-1 mr-6 text-sm font-medium transition"
            style={{ color: activeTab === tab.id ? "var(--color-ink)" : "var(--color-muted)" }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  background: activeTab === tab.id ? "var(--color-accent)" : "var(--color-border)",
                  color: activeTab === tab.id ? "#fff" : "var(--color-muted)",
                }}
              >
                {tab.count}
              </span>
            )}
            {activeTab === tab.id && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ background: "var(--color-accent)" }}
              />
            )}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>}
      {!loading && visibleLicences.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          {activeTab === "active" ? "No active licences." : "No denied or revoked licences."}
        </p>
      )}

      <div className="space-y-3">
        {visibleLicences.map((l) => {
          const expanded = expandedId === l.id;
          const feeRef = l.agreedFee ?? l.proposedFee;
          const sharePct = role === "rep"
            ? (l.agencySharePct ?? 20)
            : (l.talentSharePct ?? 65);
          const netEarnings = feeRef ? Math.round(feeRef * sharePct / 100) : null;
          const platformPct = 100 - (l.agencySharePct ?? 20) - (l.talentSharePct ?? 65);

          return (
            <div
              key={l.id}
              className="rounded border"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="p-5">
                {/* ── Summary row ─────────────────────────────────────────── */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm" style={{ color: "var(--color-ink)" }}>
                        {l.projectName}
                      </p>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          background: `${STATUS_COLOURS[l.status]}18`,
                          color: STATUS_COLOURS[l.status],
                        }}
                      >
                        {l.status}
                      </span>
                      {l.licenceType && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: "var(--color-border)", color: "var(--color-muted)" }}
                        >
                          {LICENCE_TYPE_LABELS[l.licenceType] ?? l.licenceType}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--color-muted)" }}>
                      {l.productionCompany} · {l.packageName ?? "—"}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                      Period: {formatDate(l.validFrom)} – {formatDate(l.validTo)}
                    </p>
                    {netEarnings !== null && feeRef !== null && (
                      <p className="mt-1 text-xs font-medium" style={{ color: "var(--color-accent)" }}>
                        {l.agreedFee ? "Agreed fee" : "Proposed fee"}: {fmtGBP(feeRef)} · Your earnings: {fmtGBP(netEarnings)}
                      </p>
                    )}
                    {l.downloadCount > 0 && (
                      <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                        Downloaded {l.downloadCount}× · Last: {formatDate(l.lastDownloadAt)}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : l.id)}
                      className="flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs transition"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}
                    >
                      Details
                      <svg
                        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>

                    <a
                      href={`/api/licences/${l.id}/contract`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded border px-2.5 py-1.5 text-xs transition"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}
                    >
                      Contract
                    </a>
                    {l.status === "APPROVED" && (
                      <button
                        onClick={() => revoke(l.id)}
                        disabled={revokingId === l.id}
                        className="rounded border px-3 py-1.5 text-xs transition disabled:opacity-60"
                        style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
                      >
                        {revokingId === l.id ? "Revoking…" : "Revoke"}
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Expanded details ────────────────────────────────────── */}
                {expanded && (
                  <div
                    className="mt-4 rounded border divide-y text-xs"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    {[
                      l.licenceType ? ["Usage type", LICENCE_TYPE_LABELS[l.licenceType] ?? l.licenceType] : null,
                      l.territory ? ["Territory", l.territory] : null,
                      l.exclusivity ? ["Exclusivity", EXCLUSIVITY_LABELS[l.exclusivity] ?? l.exclusivity] : null,
                      ["AI processing", l.permitAiTraining ? "Permitted" : "Not permitted"],
                      l.deniedReason ? ["Denial reason", l.deniedReason] : null,
                    ]
                      .filter((row): row is [string, string] => row !== null)
                      .map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-4 px-3 py-2">
                          <span style={{ color: "var(--color-muted)" }}>{key}</span>
                          <span
                            className="font-medium text-right"
                            style={{
                              color: key === "AI processing" && l.permitAiTraining ? "#b45309" : "var(--color-ink)",
                            }}
                          >
                            {value}
                          </span>
                        </div>
                      ))}

                    <div className="px-3 py-3">
                      <p className="mb-1" style={{ color: "var(--color-muted)" }}>Intended use</p>
                      <p className="leading-relaxed" style={{ color: "var(--color-ink)" }}>{l.intendedUse}</p>
                    </div>

                    {feeRef !== null && netEarnings !== null && (
                      <div className="px-3 py-3 space-y-1">
                        <p className="mb-2 font-medium" style={{ color: "var(--color-ink)" }}>Fee breakdown</p>
                        <div className="flex justify-between">
                          <span style={{ color: "var(--color-muted)" }}>{l.agreedFee ? "Agreed fee" : "Proposed fee"}</span>
                          <span style={{ color: "var(--color-ink)" }}>{fmtGBP(feeRef)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: "var(--color-muted)" }}>Platform fee ({platformPct}%)</span>
                          <span style={{ color: "var(--color-muted)" }}>−{fmtGBP(Math.round(feeRef * platformPct / 100))}</span>
                        </div>
                        {role === "rep" ? (
                          <div className="flex justify-between">
                            <span style={{ color: "var(--color-muted)" }}>Talent share ({l.talentSharePct ?? 65}%)</span>
                            <span style={{ color: "var(--color-muted)" }}>−{fmtGBP(Math.round(feeRef * (l.talentSharePct ?? 65) / 100))}</span>
                          </div>
                        ) : (
                          <div className="flex justify-between">
                            <span style={{ color: "var(--color-muted)" }}>Agency commission ({l.agencySharePct ?? 20}%)</span>
                            <span style={{ color: "var(--color-muted)" }}>−{fmtGBP(Math.round(feeRef * (l.agencySharePct ?? 20) / 100))}</span>
                          </div>
                        )}
                        <div
                          className="flex justify-between border-t pt-1 font-semibold"
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          <span style={{ color: "var(--color-ink)" }}>Your earnings ({sharePct}%)</span>
                          <span style={{ color: "var(--color-accent)" }}>{fmtGBP(netEarnings)}</span>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-between gap-4 px-3 py-2">
                      <span style={{ color: "var(--color-muted)" }}>Approved</span>
                      <span className="font-medium" style={{ color: "var(--color-ink)" }}>{formatDate(l.approvedAt)}</span>
                    </div>

                    {/* Delivery mode — only for approved licences */}
                    {l.status === "APPROVED" && (
                      <div className="flex items-start justify-between gap-4 px-3 py-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>Delivery mode</p>
                          <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                            {l.deliveryMode === "bridge_only"
                              ? "CAS Bridge only — licensee must use the desktop bridge app."
                              : "Standard — licensee can download directly or via CAS Bridge."}
                          </p>
                        </div>
                        <div
                          className="flex items-center rounded shrink-0 overflow-hidden"
                          style={{ border: "1px solid var(--color-border)" }}
                        >
                          {([
                            { value: "standard",    label: "Standard",   color: "#166534" },
                            { value: "bridge_only", label: "CAS Bridge", color: "#92400e" },
                          ] as const).map((opt, idx, arr) => {
                            const active = (l.deliveryMode ?? "standard") === opt.value;
                            const isSaving = togglingDeliveryId === l.id;
                            return (
                              <button
                                key={opt.value}
                                disabled={isSaving}
                                onClick={() => void toggleDeliveryMode(l)}
                                className="px-3 py-1.5 text-[11px] font-medium transition"
                                style={{
                                  background: active ? `${opt.color}18` : "transparent",
                                  color: active ? opt.color : "var(--color-muted)",
                                  borderRight: idx < arr.length - 1 ? "1px solid var(--color-border)" : "none",
                                  cursor: isSaving ? "wait" : "pointer",
                                  opacity: isSaving && !active ? 0.5 : 1,
                                }}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
