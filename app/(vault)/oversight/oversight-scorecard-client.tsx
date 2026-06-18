"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

// ── types (mirror lib/compliance/scorecard.ts) ────────────────────────────────

interface CompanyRow {
  orgId: string | null;
  orgName: string;
  isCompany: boolean;
  productionCount: number;
  productionsWithViolations: number;
  licenceCount: number;
  coverageGaps: number;
  usedWithoutConsent: number;
  usedBeforeConsent: number;
  useViolations: number;
  activeStrikes: number;
  avgHealthScore: number;
  worstHealthScore: number;
  offenderScore: number;
  repeatOffender: boolean;
}

// ── presentation helpers ──────────────────────────────────────────────────────

function scoreColour(score: number): string {
  if (score === 0) return "#1a7f37";
  if (score <= 4) return "#b45309";
  if (score <= 12) return "#c0392b";
  return "#7f1d1d";
}

function Stat({ value, label, accent, title }: { value: number | string; label: string; accent?: boolean; title?: string }) {
  const warn = accent && Number(value) > 0;
  return (
    <span className="flex items-baseline gap-1.5" title={title}>
      <span className="text-sm font-semibold tabular-nums" style={{ color: warn ? "var(--color-accent)" : "var(--color-text)" }}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>{label}</span>
    </span>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function OversightScorecardClient() {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offendersOnly, setOffendersOnly] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/compliance/scorecard");
      const d = (await res.json()) as { companies?: CompanyRow[]; error?: string };
      if (!res.ok || d.error) setError(d.error ?? `Failed (${res.status})`);
      else setRows(d.companies ?? []);
    } catch {
      setError("Failed to load scorecard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => rows.filter((r) => {
      if (offendersOnly && r.offenderScore === 0) return false;
      if (!q) return true;
      return r.orgName.toLowerCase().includes(q);
    }),
    [rows, offendersOnly, q],
  );

  const repeatCount = rows.filter((r) => r.repeatOffender).length;

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
          Oversight
        </p>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-text)" }}>Repeat offenders</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Read-only · production companies ranked by accumulated Article&nbsp;39.B breaches across their productions.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company…"
          className="text-sm rounded px-3 py-1.5 flex-1 min-w-[220px]"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
        />
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: "var(--color-muted)" }}>
          <input type="checkbox" checked={offendersOnly} onChange={(e) => setOffendersOnly(e.target.checked)} />
          Offenders only
        </label>
        {repeatCount > 0 && (
          <span className="text-[11px] font-semibold px-2 py-1 rounded"
            style={{ color: "#7f1d1d", background: "rgba(127,29,29,0.08)", border: "1px solid rgba(127,29,29,0.3)" }}>
            {repeatCount} repeat offender{repeatCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg animate-pulse" style={{ height: 88, background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg px-6 py-10 text-center" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-text)" }}>Platform-wide access required</p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          {rows.length === 0
            ? "No companies on the platform yet."
            : offendersOnly
              ? "No companies with recorded breaches. 🎉"
              : "No companies match your search."}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((c, i) => {
            const colour = scoreColour(c.offenderScore);
            return (
              <div
                key={c.orgId ?? "independent"}
                className="rounded-lg p-4"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex items-start gap-3">
                    <span className="text-sm font-semibold tabular-nums shrink-0 mt-0.5" style={{ color: "var(--color-muted)", width: 22 }}>
                      {offendersOnly ? i + 1 : "·"}
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold tracking-tight truncate flex items-center gap-2" style={{ color: "var(--color-text)" }}>
                        <span className="truncate">{c.orgName}</span>
                        {c.repeatOffender && (
                          <span className="text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0"
                            style={{ color: "#7f1d1d", background: "rgba(127,29,29,0.1)", border: "1px solid rgba(127,29,29,0.3)" }}>
                            Repeat
                          </span>
                        )}
                        {!c.isCompany && (
                          <span className="text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0"
                            style={{ color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                            No company
                          </span>
                        )}
                      </h2>
                      <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-muted)" }}>
                        {c.productionsWithViolations > 0
                          ? `Breaches across ${c.productionsWithViolations} of ${c.productionCount} production${c.productionCount !== 1 ? "s" : ""}`
                          : `${c.productionCount} production${c.productionCount !== 1 ? "s" : ""} · ${c.licenceCount} licence${c.licenceCount !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-2xl font-semibold tabular-nums leading-none" style={{ color: colour }}>{c.offenderScore}</span>
                    <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Offender score</span>
                  </div>
                </div>

                <div className="flex items-center gap-x-5 gap-y-2 mt-3 flex-wrap">
                  <Stat value={c.usedWithoutConsent} label="Used, no consent" accent title="Likeness downloaded/metered with no consent ever recorded" />
                  <Stat value={c.usedBeforeConsent} label="Used before consent" accent title="Likeness used before consent was recorded" />
                  <Stat value={c.coverageGaps} label="Coverage gaps" accent title="Live licence with no current 39.B consent" />
                  {c.activeStrikes > 0 && <Stat value={c.activeStrikes} label="Active strikes" accent />}
                  <span className="ml-auto">
                    <Stat value={`${c.avgHealthScore}%`} label="Avg health" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] mt-6" style={{ color: "var(--color-muted)" }}>
        The <strong>offender score</strong> weights breaches by severity — used with no consent (×5), used before
        consent (×4), active strike (×3), coverage gap (×2). A company is a <strong>repeat offender</strong> once
        breaches span more than one production. See the{" "}
        <Link href="/productions" className="underline" style={{ color: "var(--color-accent)" }}>Productions</Link> tracker for the per-cast detail.
      </p>
    </div>
  );
}
