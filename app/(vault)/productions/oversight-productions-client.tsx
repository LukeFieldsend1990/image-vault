"use client";

import { useCallback, useEffect, useState } from "react";

// ── types (mirror lib/compliance/productions.ts) ──────────────────────────────

interface CastSummary {
  total: number;
  consented: number;
  linked: number;
  invited: number;
  placeholder: number;
  declined: number;
  sagMembers: number;
}

interface ProductionRow {
  id: string;
  name: string;
  type: string | null;
  status: string | null;
  active: boolean;
  year: number | null;
  sagProjectNumber: string | null;
  shortCode: string | null;
  orgId: string | null;
  orgName: string | null;
  licenceCount: number;
  healthScore: number;
  complianceStatus: "compliant" | "partial" | "gap" | "critical";
  requiredGaps: number;
  coverageGaps: number;
  useViolations: number;
  cast: CastSummary;
}

type UseViolationKind = "none" | "used_without_consent" | "used_before_consent";

interface CastMember {
  id: string;
  name: string;
  characterName: string | null;
  department: string | null;
  sagMember: boolean;
  status: string;
  talentId: string | null;
  licenceId: string | null;
  coverageGap: boolean;
  useViolation: UseViolationKind;
}

interface CastDetail {
  productionId: string;
  productionName: string;
  cast: CastMember[];
}

// ── presentation helpers ──────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  film: "Feature Film", tv_series: "TV Series", tv_movie: "TV Movie",
  commercial: "Commercial", game: "Game", music_video: "Music Video", other: "Production",
};

const STATUS_LABELS: Record<string, string> = {
  development: "Development", pre_production: "Pre-Production", production: "In Production",
  post_production: "Post-Production", released: "Released", cancelled: "Cancelled",
};

const STATUS_COLOURS: Record<string, string> = {
  development: "#6b7280", pre_production: "#b45309", production: "#166534",
  post_production: "#7c3aed", released: "#0891b2", cancelled: "#374151",
};

const HEALTH_COLOURS: Record<string, string> = {
  compliant: "#1a7f37", partial: "#b45309", gap: "#c0392b", critical: "#7f1d1d",
};
const HEALTH_LABELS: Record<string, string> = {
  compliant: "Compliant", partial: "Partial", gap: "Gap", critical: "Critical",
};

const CAST_STATUS_LABELS: Record<string, string> = {
  placeholder: "Name only", invited: "Invited", linked: "Signed up",
  scan_uploaded: "Scan uploaded", consented: "Consented", declined: "Declined",
};
const CAST_STATUS_COLOURS: Record<string, string> = {
  placeholder: "#6b7280", invited: "#b45309", linked: "#7c6d0a",
  scan_uploaded: "#7c3aed", consented: "#1a7f37", declined: "#c0392b",
};

const USE_VIOLATION_LABELS: Record<Exclude<UseViolationKind, "none">, string> = {
  used_without_consent: "⛔ Used, no consent",
  used_before_consent: "⛔ Used before consent",
};

function isUseViolation(k: UseViolationKind): k is Exclude<UseViolationKind, "none"> {
  return k === "used_without_consent" || k === "used_before_consent";
}

function PhaseIndicator({ status }: { status: string | null }) {
  if (!status) return null;
  const colour = STATUS_COLOURS[status] ?? "#6b7280";
  const label = STATUS_LABELS[status] ?? status;
  const pulse = status === "production";
  return (
    <span className="flex items-center gap-1.5">
      {pulse ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50" style={{ background: colour }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: colour }} />
        </span>
      ) : (
        <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: colour }} />
      )}
      <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: colour }}>{label}</span>
    </span>
  );
}

function HealthBadge({ score, status }: { score: number; status: ProductionRow["complianceStatus"] }) {
  const c = HEALTH_COLOURS[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded"
      style={{ color: c, border: `1px solid ${c}44`, background: `${c}11` }}>
      {score}% {HEALTH_LABELS[status]}
    </span>
  );
}

// ── cast roster modal ─────────────────────────────────────────────────────────

function CastModal({ production, onClose }: { production: ProductionRow; onClose: () => void }) {
  const [detail, setDetail] = useState<CastDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/compliance/productions/${production.id}/cast`)
      .then((r) => r.json() as Promise<CastDetail | { error: string }>)
      .then((d) => {
        if (!live) return;
        if ("error" in d) setError(d.error);
        else setDetail(d);
      })
      .catch(() => live && setError("Failed to load cast."))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [production.id]);

  const gapCount = detail?.cast.filter((c) => c.coverageGap).length ?? 0;
  const violationCount = detail?.cast.filter((c) => isUseViolation(c.useViolation)).length ?? 0;

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 40 }} onClick={onClose} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: "min(94vw, 760px)", maxHeight: "85vh", overflowY: "auto",
        background: "var(--color-surface)", border: "1px solid var(--color-border)",
        borderRadius: "10px", zIndex: 41, padding: "24px",
      }}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>{production.name}</h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              {production.orgName ?? "Independent"} · Cast roster
              {violationCount > 0 && (
                <span style={{ color: "#7f1d1d", fontWeight: 600 }}> · {violationCount} use-before-consent breach{violationCount !== 1 ? "es" : ""}</span>
              )}
              {gapCount > 0 && (
                <span style={{ color: "#c0392b", fontWeight: 600 }}> · {gapCount} coverage gap{gapCount !== 1 ? "s" : ""}</span>
              )}
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: "20px", lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading cast…</p>
        ) : error ? (
          <p className="text-sm" style={{ color: "var(--color-accent)" }}>{error}</p>
        ) : !detail || detail.cast.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>No cast recorded for this production yet.</p>
        ) : (
          <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
            {detail.cast.map((m) => {
              const sc = CAST_STATUS_COLOURS[m.status] ?? "var(--color-muted)";
              const violation = isUseViolation(m.useViolation);
              return (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5"
                  style={{ background: violation ? "rgba(127,29,29,0.07)" : m.coverageGap ? "rgba(192,57,43,0.05)" : undefined }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--color-text)" }}>
                      <span className="truncate">{m.name}</span>
                      {m.sagMember && (
                        <span className="text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0"
                          style={{ color: "#7c3aed", background: "rgba(124,58,237,0.1)" }}>SAG</span>
                      )}
                    </p>
                    <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-muted)" }}>
                      {m.characterName ?? "—"}{m.department ? ` · ${m.department}` : ""}
                    </p>
                  </div>
                  {isUseViolation(m.useViolation) ? (
                    <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded shrink-0"
                      style={{ color: "#7f1d1d", border: "1px solid #7f1d1d44", background: "rgba(127,29,29,0.1)" }}>
                      {USE_VIOLATION_LABELS[m.useViolation]}
                    </span>
                  ) : m.coverageGap ? (
                    <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded shrink-0"
                      style={{ color: "#c0392b", border: "1px solid #c0392b44", background: "rgba(192,57,43,0.08)" }}>
                      ⚠ No consent
                    </span>
                  ) : null}
                  <span className="text-[10px] font-semibold uppercase tracking-widest w-24 text-right shrink-0" style={{ color: sc }}>
                    {CAST_STATUS_LABELS[m.status] ?? m.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[11px] mt-4" style={{ color: "var(--color-muted)" }}>
          A <strong>coverage gap</strong> means the member&apos;s likeness is licensed with no current Article&nbsp;39.B
          consent on record. A <strong style={{ color: "#7f1d1d" }}>use-before-consent breach</strong> is stronger: the
          ledger shows the likeness was downloaded or metered <em>before</em> any consent existed (or with none recorded
          at all) — a permanent Article&nbsp;39.B violation that stands even if consent is later back-filled.
        </p>
      </div>
    </>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function OversightProductionsClient() {
  const [rows, setRows] = useState<ProductionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProductionRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/compliance/productions");
      const d = (await res.json()) as { productions?: ProductionRow[]; error?: string };
      if (!res.ok || d.error) setError(d.error ?? `Failed (${res.status})`);
      else setRows(d.productions ?? []);
    } catch {
      setError("Failed to load productions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const q = query.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (activeOnly && !r.active) return false;
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      (r.orgName ?? "").toLowerCase().includes(q) ||
      (r.sagProjectNumber ?? "").toLowerCase().includes(q)
    );
  });

  const activeCount = rows.filter((r) => r.active).length;
  const totalCoverageGaps = rows.reduce((s, r) => s + r.coverageGaps, 0);
  const totalUseViolations = rows.reduce((s, r) => s + r.useViolations, 0);

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
          Oversight
        </p>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-text)" }}>Productions</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Read-only · every production on the platform, with compliance health and cast visibility.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search production, organisation, SAG number…"
          className="text-sm rounded px-3 py-1.5 flex-1 min-w-[220px]"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
        />
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: "var(--color-muted)" }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Active only{!loading && ` (${activeCount})`}
        </label>
        {totalUseViolations > 0 && (
          <span className="text-[11px] font-semibold px-2 py-1 rounded"
            style={{ color: "#7f1d1d", background: "rgba(127,29,29,0.08)", border: "1px solid rgba(127,29,29,0.3)" }}>
            {totalUseViolations} use-before-consent breach{totalUseViolations !== 1 ? "es" : ""} platform-wide
          </span>
        )}
        {totalCoverageGaps > 0 && (
          <span className="text-[11px] font-semibold px-2 py-1 rounded"
            style={{ color: "#c0392b", background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.3)" }}>
            {totalCoverageGaps} coverage gap{totalCoverageGaps !== 1 ? "s" : ""} platform-wide
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg animate-pulse" style={{ height: 84, background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg px-6 py-10 text-center" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-text)" }}>Platform-wide access required</p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          {rows.length === 0 ? "No productions on the platform yet." : "No productions match your filter."}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => {
            const castPct = p.cast.total > 0 ? Math.round((p.cast.consented / p.cast.total) * 100) : null;
            const castColour = castPct === null ? "var(--color-muted)" : castPct === 100 ? "#166534" : castPct > 50 ? "#b45309" : "#c0392b";
            return (
              <button
                key={p.id}
                onClick={() => setSelected(p)}
                className="w-full text-left rounded-lg p-4 transition hover:opacity-90"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", cursor: "pointer" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 mb-1">
                      {p.type && (
                        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                          {TYPE_LABELS[p.type] ?? p.type}
                        </span>
                      )}
                      <PhaseIndicator status={p.status} />
                    </div>
                    <h2 className="text-base font-semibold tracking-tight truncate" style={{ color: "var(--color-text)" }}>{p.name}</h2>
                    <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-muted)" }}>
                      {p.orgName ?? "Independent"}
                      {p.sagProjectNumber ? ` · SAG ${p.sagProjectNumber}` : ""}
                      {p.year ? ` · ${p.year}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <HealthBadge score={p.healthScore} status={p.complianceStatus} />
                    {p.useViolations > 0 && (
                      <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded"
                        style={{ color: "#7f1d1d", border: "1px solid #7f1d1d44", background: "rgba(127,29,29,0.1)" }}>
                        ⛔ {p.useViolations} use-before-consent breach{p.useViolations !== 1 ? "es" : ""}
                      </span>
                    )}
                    {p.coverageGaps > 0 && (
                      <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded"
                        style={{ color: "#c0392b", border: "1px solid #c0392b44", background: "rgba(192,57,43,0.08)" }}>
                        ⚠ {p.coverageGaps} no-consent
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-5 mt-3 flex-wrap">
                  <Metric value={p.licenceCount} label={p.licenceCount === 1 ? "Licence" : "Licences"} />
                  <Metric value={p.requiredGaps} label="Required gaps" warn={p.requiredGaps > 0} />
                  <Metric value={`${p.cast.consented}/${p.cast.total}`} label="Cast consented" />
                  {p.cast.sagMembers > 0 && <Metric value={p.cast.sagMembers} label="SAG members" />}
                  {castPct !== null && (
                    <span className="ml-auto flex items-center gap-2">
                      <span className="inline-flex w-24 h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                        <span className="h-full rounded-full" style={{ width: `${castPct}%`, background: castColour }} />
                      </span>
                      <span className="text-[10px] font-semibold tabular-nums" style={{ color: castColour }}>{castPct}%</span>
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && <CastModal production={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Metric({ value, label, warn }: { value: number | string; label: string; warn?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-sm font-semibold tabular-nums" style={{ color: warn && Number(value) > 0 ? "var(--color-accent)" : "var(--color-text)" }}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>{label}</span>
    </span>
  );
}
