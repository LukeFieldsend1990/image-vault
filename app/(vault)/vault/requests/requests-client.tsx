"use client";

import { useEffect, useState } from "react";
import FeeGuidanceCard from "./fee-guidance-card";

interface Licence {
  id: string;
  packageName: string | null;
  projectName: string;
  productionCompany: string;
  intendedUse: string;
  validFrom: number;
  validTo: number;
  status: string;
  createdAt: number;
  licenseeId: string;
  talentEmail: string | null;
  licenceType: string | null;
  territory: string | null;
  exclusivity: string | null;
  permitAiTraining: boolean;
  proposedFee: number | null; // pence
  agencySharePct: number | null;
  talentSharePct: number | null;
}

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

export default function RequestsClient({ isRep = false }: { isRep?: boolean }) {
  const [requests, setRequests] = useState<Licence[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/licences?status=PENDING");
    const d = await r.json() as { licences?: Licence[] };
    setRequests(d.licences ?? []);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  async function approve(id: string) {
    setActionId(id);
    await fetch(`/api/licences/${id}/approve`, { method: "POST" });
    await load();
    setActionId(null);
  }

  async function deny(id: string) {
    setActionId(id);
    await fetch(`/api/licences/${id}/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: denyReason }),
    });
    setDenyingId(null);
    setDenyReason("");
    await load();
    setActionId(null);
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Incoming Requests
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Review and approve or deny licence requests from production companies.
        </p>
      </div>

      {loading && <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>}

      {!loading && requests.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No pending requests.</p>
      )}

      <div className="space-y-4">
        {requests.map((r) => {
          const expanded = expandedId === r.id;
          const sharePct = isRep ? (r.agencySharePct ?? 20) : (r.talentSharePct ?? 65);
          const netEarnings = r.proposedFee ? Math.round(r.proposedFee * sharePct / 100) : null;

          return (
            <div
              key={r.id}
              className="rounded border"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              {/* ── Header row ─────────────────────────────────────────────── */}
              <div className="p-5">
                {r.permitAiTraining && (
                  <div
                    className="mb-3 flex items-center gap-2 rounded border px-3 py-2 text-xs"
                    style={{ borderColor: "#dc2626", background: "rgba(220,38,38,0.06)", color: "#991b1b" }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span className="font-semibold">AI processing requested</span>
                    <span style={{ color: "#7f1d1d" }}>— review carefully before approving</span>
                  </div>
                )}

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {isRep && r.talentEmail && (
                      <p className="truncate text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "var(--color-accent)" }}>
                        {r.talentEmail}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm" style={{ color: "var(--color-ink)" }}>
                        {r.projectName}
                      </p>
                      {r.licenceType && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: "var(--color-border)", color: "var(--color-muted)" }}
                        >
                          {LICENCE_TYPE_LABELS[r.licenceType] ?? r.licenceType}
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                      {r.productionCompany} · Package: {r.packageName ?? "—"}
                    </p>
                    <p className="text-xs mt-2" style={{ color: "var(--color-muted)" }}>
                      Licence period: {formatDate(r.validFrom)} – {formatDate(r.validTo)} · Received {formatDate(r.createdAt)}
                    </p>
                    {r.proposedFee && netEarnings !== null && (
                      <p className="text-xs mt-1 font-medium" style={{ color: "var(--color-accent)" }}>
                        Proposed fee: {fmtGBP(r.proposedFee)} · Your earnings: {fmtGBP(netEarnings)}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                    className="flex-shrink-0 flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs transition hover:bg-opacity-80"
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
                </div>

                {/* ── Expanded details ──────────────────────────────────────── */}
                {expanded && (
                  <div
                    className="mt-4 rounded border divide-y text-xs"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    {[
                      r.licenceType ? ["Usage type", LICENCE_TYPE_LABELS[r.licenceType] ?? r.licenceType] : null,
                      r.territory ? ["Territory", r.territory] : null,
                      r.exclusivity ? ["Exclusivity", EXCLUSIVITY_LABELS[r.exclusivity] ?? r.exclusivity] : null,
                      ["AI processing", r.permitAiTraining ? "Requested" : "Not requested"],
                    ]
                      .filter((row): row is [string, string] => row !== null)
                      .map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-4 px-3 py-2">
                          <span style={{ color: "var(--color-muted)" }}>{key}</span>
                          <span
                            className="font-medium text-right"
                            style={{
                              color: key === "AI processing" && r.permitAiTraining ? "#dc2626" : "var(--color-ink)",
                            }}
                          >
                            {value}
                          </span>
                        </div>
                      ))}

                    <div className="px-3 py-3">
                      <p className="mb-1" style={{ color: "var(--color-muted)" }}>Intended use</p>
                      <p className="leading-relaxed" style={{ color: "var(--color-ink)" }}>{r.intendedUse}</p>
                    </div>

                    {/* AI Fee Guidance */}
                    {r.licenceType && (
                      <div className="px-3 py-3">
                        <FeeGuidanceCard
                          licenceType={r.licenceType}
                          territory={r.territory}
                          exclusivity={r.exclusivity}
                          proposedFee={r.proposedFee}
                        />
                      </div>
                    )}

                    {r.proposedFee && netEarnings !== null && (
                      <div className="px-3 py-3 space-y-1">
                        <p className="mb-2 font-medium" style={{ color: "var(--color-ink)" }}>Fee breakdown</p>
                        <div className="flex justify-between">
                          <span style={{ color: "var(--color-muted)" }}>Proposed fee</span>
                          <span style={{ color: "var(--color-ink)" }}>{fmtGBP(r.proposedFee)}</span>
                        </div>
                        {(() => {
                          const platPct = 100 - (r.agencySharePct ?? 20) - (r.talentSharePct ?? 65);
                          return (
                            <>
                              <div className="flex justify-between">
                                <span style={{ color: "var(--color-muted)" }}>Platform fee ({platPct}%)</span>
                                <span style={{ color: "var(--color-muted)" }}>−{fmtGBP(Math.round(r.proposedFee * platPct / 100))}</span>
                              </div>
                              {isRep ? (
                                <div className="flex justify-between">
                                  <span style={{ color: "var(--color-muted)" }}>Talent share ({r.talentSharePct ?? 65}%)</span>
                                  <span style={{ color: "var(--color-muted)" }}>−{fmtGBP(Math.round(r.proposedFee * (r.talentSharePct ?? 65) / 100))}</span>
                                </div>
                              ) : (
                                <div className="flex justify-between">
                                  <span style={{ color: "var(--color-muted)" }}>Agency commission ({r.agencySharePct ?? 20}%)</span>
                                  <span style={{ color: "var(--color-muted)" }}>−{fmtGBP(Math.round(r.proposedFee * (r.agencySharePct ?? 20) / 100))}</span>
                                </div>
                              )}
                            </>
                          );
                        })()}
                        <div
                          className="flex justify-between border-t pt-1 font-semibold"
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          <span style={{ color: "var(--color-ink)" }}>Your earnings ({sharePct}%)</span>
                          <span style={{ color: "var(--color-accent)" }}>{fmtGBP(netEarnings)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Deny inline form ──────────────────────────────────────── */}
                {denyingId === r.id ? (
                  <div className="mt-4 space-y-2">
                    <input
                      type="text"
                      value={denyReason}
                      onChange={(e) => setDenyReason(e.target.value)}
                      placeholder="Reason for denial (optional)"
                      className="w-full rounded border px-3 py-2 text-sm outline-none"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => deny(r.id)}
                        disabled={actionId === r.id}
                        className="rounded px-4 py-2 text-xs font-medium text-white disabled:opacity-60"
                        style={{ background: "var(--color-danger)" }}
                      >
                        Confirm Deny
                      </button>
                      <button
                        onClick={() => { setDenyingId(null); setDenyReason(""); }}
                        className="rounded px-4 py-2 text-xs font-medium"
                        style={{ color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => approve(r.id)}
                      disabled={actionId === r.id}
                      className="rounded px-4 py-2 text-xs font-medium text-white transition disabled:opacity-60"
                      style={{ background: "var(--color-accent)" }}
                    >
                      {actionId === r.id ? "Processing…" : "Approve"}
                    </button>
                    <button
                      onClick={() => setDenyingId(r.id)}
                      disabled={actionId === r.id}
                      className="rounded border px-4 py-2 text-xs font-medium transition"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                    >
                      Deny
                    </button>
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
