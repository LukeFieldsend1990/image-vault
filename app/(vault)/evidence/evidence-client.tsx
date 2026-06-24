"use client";

import { useState, useEffect, useCallback } from "react";
import ComplianceClient from "../compliance/compliance-client";

interface Grant {
  id: string;
  subtype: string;
  scope: string;
  scopeId: string | null;
  label: string;
}

interface Obligation {
  id: string;
  clauseRef: string;
  title: string;
  status: "met" | "gap" | "n/a" | "pending";
  severity: "required" | "recommended";
}

interface Evidence {
  label: string;
  licenceCount: number;
  eventCount: number;
  requiredGaps: number;
  obligations: Obligation[];
  certificates: { id: string; regime: string; ledgerTipHash: string; eventCount: number; generatedAt: number }[];
}

function fmtDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_COLOR: Record<string, string> = {
  met: "#1a7f37", gap: "#c0392b", pending: "#2563eb", "n/a": "var(--color-muted)",
};

const STATUS_LABEL: Record<string, string> = {
  met: "✓ Met", gap: "⚠ Gap", pending: "⏳ Pending", "n/a": "N/A",
};

export default function EvidenceClient() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Grant | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [loadingEv, setLoadingEv] = useState(false);

  const loadGrants = useCallback(async () => {
    try {
      const res = await fetch("/api/compliance/evidence");
      const d = (await res.json()) as { grants?: Grant[] };
      const list = d.grants ?? [];
      setGrants(list);
      // Auto-select the first non-platform grant so the user lands on usable evidence.
      const firstUsable = list.find((g) => g.scope !== "platform") ?? list[0] ?? null;
      if (firstUsable) setSelected(firstUsable);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadGrants(); }, [loadGrants]);

  const fetchEvidence = useCallback(async (scope: string, id: string, regime?: string) => {
    setLoadingEv(true); setEvidence(null);
    try {
      const qs = new URLSearchParams({ scope, id });
      if (regime) qs.set("regime", regime);
      const res = await fetch(`/api/compliance/evidence?${qs.toString()}`);
      if (res.ok) setEvidence((await res.json()) as Evidence);
    } catch {
      // ignore
    } finally {
      setLoadingEv(false);
    }
  }, []);

  // When the selected scope isn't a union, fetch per-scope evidence. Union scopes
  // render a full ComplianceClient instead — no per-scope evidence fetch needed.
  useEffect(() => {
    if (!selected) return;
    if (selected.scope === "platform" || selected.scope === "union") return;
    void fetchEvidence(selected.scope, selected.scopeId ?? "");
  }, [selected, fetchEvidence]);

  if (loading) return <p className="p-8 text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>;

  // A platform-wide grant subsumes every scope — surface the full interactive
  // compliance control centre (read-only) instead of a per-scope drill-down.
  const hasPlatform = grants.some((g) => g.scope === "platform");
  if (hasPlatform) {
    return (
      <ComplianceClient
        readOnly
        dashboardUrl="/api/compliance/platform-dashboard"
        title="Platform Compliance"
        subtitle="Read-only · platform-wide access across every production, licence and obligation."
      />
    );
  }

  function evidencePanel() {
    if (loadingEv) return <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading evidence…</p>;
    if (!evidence) return <p className="text-sm" style={{ color: "var(--color-muted)" }}>No evidence available.</p>;
    return (
      <div className="space-y-5">
        <div className="rounded border p-4" style={{ borderColor: "var(--color-border)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{evidence.label}</p>
          <p className="text-[11px] mt-1" style={{ color: "var(--color-muted)" }}>
            {evidence.licenceCount} licence(s) · {evidence.eventCount} ledger event(s) · {evidence.requiredGaps} required gap(s)
          </p>
        </div>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>Obligation progress</h2>
          {evidence.obligations.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>No obligations apply to this scope yet.</p>
          ) : (
            <div className="rounded border px-3" style={{ borderColor: "var(--color-border)" }}>
              {evidence.obligations.map((o) => {
                const color = STATUS_COLOR[o.status] ?? "var(--color-muted)";
                const advisory = o.severity !== "required";
                const isMet = o.status === "met";
                const isGap = o.status === "gap";
                const barColor = isGap ? (advisory ? "#b45309" : color) : isMet ? "#1a7f37" : "var(--color-border)";
                const pct = isMet ? 100 : isGap ? 100 : 0;
                return (
                  <div key={o.id} className="flex items-center gap-4 py-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <span className="text-xs font-mono w-12 shrink-0" style={{ color: "var(--color-muted)" }}>
                      {o.clauseRef}
                    </span>
                    <span className="text-sm flex-1 min-w-0 truncate" style={{ color: "var(--color-ink)" }}>
                      {o.title}
                    </span>
                    <div className="w-32 shrink-0">
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor, transition: "width 0.4s ease" }} />
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-widest w-20 text-right shrink-0 font-medium" style={{ color }}>
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>Certificates</h2>
          {evidence.certificates.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>No certificates generated for this scope yet.</p>
          ) : (
            <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
              {evidence.certificates.map((c) => (
                <a key={c.id} href={`/api/compliance/certificates/${c.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--color-surface)]">
                  <span className="text-sm" style={{ color: "var(--color-ink)" }}>{c.regime} · {c.eventCount} events</span>
                  <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>{fmtDate(c.generatedAt)}</span>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Scope picker — kept on the far left as the regime selector for a union watcher. */}
      <aside className="shrink-0 w-[220px] border-r p-4 space-y-1 overflow-y-auto" style={{ borderColor: "var(--color-border)" }}>
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>Scopes</p>
        {grants.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>No scopes shared yet.</p>
        ) : (
          grants.map((g) => (
            <button
              key={g.id}
              onClick={() => setSelected(g)}
              className="w-full text-left px-3 py-2 rounded border text-sm transition"
              style={{
                borderColor: selected?.id === g.id ? "var(--color-accent)" : "var(--color-border)",
                background: selected?.id === g.id ? "var(--color-surface)" : "transparent",
                color: "var(--color-ink)",
              }}
            >
              <div className="truncate">{g.label}</div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>{g.subtype} · {g.scope}</div>
            </button>
          ))
        )}
      </aside>

      {/* Detail pane */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {!selected ? (
          <p className="p-8 text-sm" style={{ color: "var(--color-muted)" }}>Select a scope to view its evidence.</p>
        ) : selected.scope === "platform" ? (
          <p className="p-8 text-sm" style={{ color: "var(--color-muted)" }}>Platform-wide grant — request a specific production, organisation or talent scope to view its obligation status.</p>
        ) : selected.scope === "union" ? (
          // Full across-slate compliance view for the union — KPIs, obligation
          // progress, productions cards, action queue. ProductionCard click opens
          // the existing per-production drill-down modal inside ComplianceClient.
          <ComplianceClient
            readOnly
            hideRegimeSelector
            dashboardUrl={`/api/compliance/union-dashboard?unionId=${encodeURIComponent(selected.scopeId ?? "")}`}
            title={`${selected.label} compliance`}
            subtitle="Read-only · obligations across every production an affiliated talent is involved in."
          />
        ) : (
          <div className="p-8 max-w-3xl">
            {evidencePanel()}
          </div>
        )}
      </div>
    </div>
  );
}
