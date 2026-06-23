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
  key: string;
  label: string;
  status: string;
  severity: string;
}

interface Evidence {
  label: string;
  licenceCount: number;
  eventCount: number;
  requiredGaps: number;
  obligations: Obligation[];
  certificates: { id: string; regime: string; ledgerTipHash: string; eventCount: number; generatedAt: number }[];
}

interface UnionView {
  unionId: string;
  shortName: string;
  name: string;
  talent: { talentId: string; name: string }[];
  productions: { id: string; name: string; status: string | null }[];
}

function fmtDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_COLOR: Record<string, string> = {
  satisfied: "#166534", met: "#166534", gap: "#c0392b", pending: "#92400e",
};

export default function EvidenceClient() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Grant | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [unionView, setUnionView] = useState<UnionView | null>(null);
  // Drill-down from a union view into one affiliated talent / production.
  const [drill, setDrill] = useState<{ scope: string; id: string; label: string } | null>(null);
  const [loadingEv, setLoadingEv] = useState(false);

  const loadGrants = useCallback(async () => {
    try {
      const res = await fetch("/api/compliance/evidence");
      const d = (await res.json()) as { grants?: Grant[] };
      setGrants(d.grants ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadGrants(); }, [loadGrants]);

  async function fetchEvidence(scope: string, id: string) {
    setLoadingEv(true); setEvidence(null);
    try {
      const res = await fetch(`/api/compliance/evidence?scope=${scope}&id=${encodeURIComponent(id)}`);
      if (res.ok) setEvidence((await res.json()) as Evidence);
    } catch {
      // ignore
    } finally {
      setLoadingEv(false);
    }
  }

  async function open(g: Grant) {
    setSelected(g); setEvidence(null); setUnionView(null); setDrill(null);
    if (g.scope === "platform") return;
    if (g.scope === "union") {
      setLoadingEv(true);
      try {
        const res = await fetch(`/api/compliance/union?id=${encodeURIComponent(g.scopeId ?? "")}`);
        if (res.ok) {
          const d = (await res.json()) as { unions?: UnionView[] };
          setUnionView(d.unions?.[0] ?? null);
        }
      } catch {
        // ignore
      } finally {
        setLoadingEv(false);
      }
      return;
    }
    void fetchEvidence(g.scope, g.scopeId ?? "");
  }

  function drillInto(scope: string, id: string, label: string) {
    setDrill({ scope, id, label });
    void fetchEvidence(scope, id);
  }

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
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>Obligations</h2>
          <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
            {evidence.obligations.map((o) => (
              <div key={o.key} className="flex items-center justify-between px-4 py-2">
                <span className="text-sm" style={{ color: "var(--color-ink)" }}>{o.label}</span>
                <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: STATUS_COLOR[o.status] ?? "var(--color-muted)" }}>{o.status}</span>
              </div>
            ))}
          </div>
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

  function unionPanel(uv: UnionView) {
    return (
      <div className="space-y-5">
        <div className="rounded border p-4" style={{ borderColor: "var(--color-border)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{uv.name}</p>
          <p className="text-[11px] mt-1" style={{ color: "var(--color-muted)" }}>
            {uv.talent.length} affiliated talent on platform · {uv.productions.length} production(s) they are involved in
          </p>
        </div>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>Affiliated talent</h2>
          {uv.talent.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>No roster members are on the platform yet.</p>
          ) : (
            <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
              {uv.talent.map((t) => (
                <button key={t.talentId} onClick={() => drillInto("talent", t.talentId, t.name)} className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-[var(--color-surface)]">
                  <span className="text-sm" style={{ color: "var(--color-ink)" }}>{t.name}</span>
                  <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>View evidence →</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>Affiliated productions</h2>
          {uv.productions.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>No productions yet involve an affiliated member.</p>
          ) : (
            <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
              {uv.productions.map((p) => (
                <button key={p.id} onClick={() => drillInto("production", p.id, p.name)} className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-[var(--color-surface)]">
                  <span className="text-sm" style={{ color: "var(--color-ink)" }}>{p.name}</span>
                  <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>{p.status ?? "—"}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Compliance Evidence</h1>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Read-only obligation status and audit trail for the scopes you have been granted.</p>
      </div>

      {grants.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No scopes have been shared with you yet.</p>
      ) : (
        <div className="grid grid-cols-[220px_1fr] gap-6">
          {/* Scope list */}
          <div className="space-y-1">
            {grants.map((g) => (
              <button
                key={g.id}
                onClick={() => void open(g)}
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
            ))}
          </div>

          {/* Detail */}
          <div>
            {!selected ? (
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>Select a scope to view its evidence.</p>
            ) : selected.scope === "platform" ? (
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>Platform-wide grant — request a specific production, organisation or talent scope to view its obligation status.</p>
            ) : selected.scope === "union" ? (
              drill ? (
                <div className="space-y-4">
                  <button onClick={() => { setDrill(null); setEvidence(null); }} className="text-[11px]" style={{ color: "var(--color-accent)" }}>← Back to {selected.label}</button>
                  <p className="text-xs font-medium" style={{ color: "var(--color-muted)" }}>{drill.scope === "talent" ? "Talent" : "Production"}: {drill.label}</p>
                  {evidencePanel()}
                </div>
              ) : loadingEv ? (
                <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>
              ) : !unionView ? (
                <p className="text-sm" style={{ color: "var(--color-muted)" }}>No affiliated entities available for this union yet.</p>
              ) : (
                unionPanel(unionView)
              )
            ) : (
              evidencePanel()
            )}
          </div>
        </div>
      )}
    </div>
  );
}
