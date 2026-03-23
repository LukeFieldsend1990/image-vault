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
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 0 })}`;
}

export default function TalentLicencesClient({ role = "talent" }: { role?: string }) {
  const [licences, setLicences] = useState<Licence[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/licences");
    const d = await r.json() as { licences?: Licence[] };
    setLicences((d.licences ?? []).filter((l) => l.status !== "PENDING"));
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  async function revoke(id: string) {
    if (!confirm("Revoke this licence? Any pending downloads will be cancelled.")) return;
    setRevokingId(id);
    await fetch(`/api/licences/${id}/revoke`, { method: "POST" });
    await load();
    setRevokingId(null);
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Granted Licences
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Licences you have approved, denied, or revoked.
        </p>
      </div>

      {loading && <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>}
      {!loading && licences.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No licences yet.</p>
      )}

      <div className="space-y-3">
        {licences.map((l) => {
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
