"use client";

import { useState, useEffect, useCallback } from "react";

type Grade = "A" | "B" | "C" | "D";
type PolicyLine = "eo" | "cyber" | "completion_bond" | "other";

interface PortfolioRow {
  productionId: string;
  name: string;
  type: string | null;
  status: string | null;
  active: boolean;
  orgName: string | null;
  grade: Grade;
  healthScore: number;
  coverageGaps: number;
  useViolations: number;
  castTotal: number;
  castConsented: number;
  policyCount: number;
  hasLapsedPolicy: boolean;
  uninsuredUse: boolean;
}

interface Policy {
  id: string;
  policyNumber: string | null;
  policyLine: PolicyLine;
  coverageLimit: number | null;
  currency: string;
  effectiveFrom: number | null;
  effectiveTo: number | null;
  notes: string | null;
  createdAt: number;
  lapsed: boolean;
}

interface CastSummary {
  total: number; consented: number; linked: number; invited: number; placeholder: number; declined: number; sagMembers: number;
}

interface UnderwritingView {
  production: { id: string; name: string; type: string | null; status: string | null; active: boolean; year: number | null; orgName: string | null };
  grade: Grade;
  healthScore: number;
  cast: CastSummary;
  licenceCount: number;
  coverageGaps: number;
  useViolations: number;
  usedWithoutConsent: number;
  usedBeforeConsent: number;
  activeStrikes: number;
  policies: Policy[];
  uninsuredUse: boolean;
  firstUseAt: number | null;
  lastUseAt: number | null;
}

const GRADE_COLOR: Record<Grade, string> = { A: "#166534", B: "#3f6212", C: "#92400e", D: "#c0392b" };
const GRADE_LABEL: Record<Grade, string> = { A: "Low risk", B: "Acceptable", C: "Elevated risk", D: "High risk" };
const LINE_LABEL: Record<PolicyLine, string> = {
  eo: "E&O", cyber: "Cyber / privacy", completion_bond: "Completion bond", other: "Other",
};

function fmtDate(epoch: number | null): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function dateToEpoch(d: string): number | undefined {
  if (!d) return undefined;
  const ms = Date.parse(d + "T00:00:00Z");
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}
function fmtMoney(amount: number | null, currency: string): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}
function titleCase(s: string | null): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function GradeBadge({ grade, size = "sm" }: { grade: Grade; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? { w: 56, h: 56, f: 28 } : { w: 28, h: 28, f: 14 };
  return (
    <div
      className="flex items-center justify-center rounded font-bold"
      style={{ width: dim.w, height: dim.h, fontSize: dim.f, background: GRADE_COLOR[grade], color: "#fff" }}
    >
      {grade}
    </div>
  );
}

function Metric({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className="rounded border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <div className="text-2xl font-semibold" style={{ color: alert ? "#c0392b" : "var(--color-ink)" }}>{value}</div>
      <div className="text-[11px] uppercase tracking-widest mt-1" style={{ color: "var(--color-muted)" }}>{label}</div>
    </div>
  );
}

export default function UnderwritingClient() {
  const [portfolio, setPortfolio] = useState<PortfolioRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<UnderwritingView | null>(null);
  const [loadingView, setLoadingView] = useState(false);

  const loadPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/insurer/productions");
      const d = (await res.json()) as { productions?: PortfolioRow[] };
      const rows = d.productions ?? [];
      setPortfolio(rows);
      setSelectedId((prev) => prev ?? rows[0]?.productionId ?? null);
    } catch {
      setPortfolio([]);
    }
  }, []);

  const loadView = useCallback(async (id: string) => {
    setLoadingView(true);
    setView(null);
    try {
      const res = await fetch(`/api/insurer/productions/${id}`);
      if (res.ok) setView((await res.json()) as UnderwritingView);
    } catch {
      // ignore
    } finally {
      setLoadingView(false);
    }
  }, []);

  useEffect(() => { void loadPortfolio(); }, [loadPortfolio]);
  useEffect(() => { if (selectedId) void loadView(selectedId); }, [selectedId, loadView]);

  if (portfolio === null) {
    return <p className="p-8 text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>;
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Underwriting</h1>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Read-only, court-grade consent and custody evidence for the productions you cover. Risk grade composes coverage gaps, use-before-consent breaches and active strikes.
        </p>
      </div>

      {portfolio.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No productions have been shared with you yet. A production coordinator adds your firm as an insurer from their production page.
        </p>
      ) : (
        <div className="grid grid-cols-[280px_1fr] gap-6">
          {/* Portfolio list */}
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
              Portfolio · {portfolio.length}
            </div>
            {portfolio.map((p) => (
              <button
                key={p.productionId}
                onClick={() => setSelectedId(p.productionId)}
                className="w-full text-left px-3 py-2.5 rounded border transition flex items-center gap-3"
                style={{
                  borderColor: selectedId === p.productionId ? "var(--color-accent)" : "var(--color-border)",
                  background: selectedId === p.productionId ? "var(--color-surface)" : "transparent",
                }}
              >
                <GradeBadge grade={p.grade} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" style={{ color: "var(--color-ink)" }}>{p.name}</div>
                  <div className="text-[10px] uppercase tracking-wide truncate" style={{ color: "var(--color-muted)" }}>
                    {p.orgName ?? "Independent"} · {titleCase(p.type)}
                  </div>
                </div>
                {(p.useViolations > 0 || p.uninsuredUse || p.hasLapsedPolicy) && (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#c0392b" }} title="Risk flag" />
                )}
              </button>
            ))}
          </div>

          {/* Detail */}
          <div>
            {loadingView ? (
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading production…</p>
            ) : !view ? (
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>Select a production.</p>
            ) : (
              <Detail view={view} onPolicyChange={() => { void loadView(view.production.id); void loadPortfolio(); }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ view, onPolicyChange }: { view: UnderwritingView; onPolicyChange: () => void }) {
  const p = view.production;
  return (
    <div className="space-y-6">
      {/* Grade hero */}
      <div className="rounded border p-5 flex items-center gap-5" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <GradeBadge grade={view.grade} size="lg" />
        <div className="flex-1">
          <div className="text-base font-semibold" style={{ color: "var(--color-ink)" }}>{p.name}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
            {p.orgName ?? "Independent"} · {titleCase(p.type)}{p.year ? ` · ${p.year}` : ""} · {titleCase(p.status)}
          </div>
          <div className="text-xs mt-1 font-medium" style={{ color: GRADE_COLOR[view.grade] }}>
            Grade {view.grade} — {GRADE_LABEL[view.grade]} · health {view.healthScore}/100
          </div>
        </div>
      </div>

      {/* Risk flags */}
      {(view.useViolations > 0 || view.uninsuredUse || view.activeStrikes > 0 || view.policies.some((pol) => pol.lapsed)) && (
        <div className="rounded border p-4 space-y-1.5" style={{ borderColor: "#c0392b", background: "rgba(192,57,43,0.05)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#c0392b" }}>Underwriting alerts</div>
          {view.usedWithoutConsent > 0 && <Alert>{view.usedWithoutConsent} likeness use(s) with no consent on record — E&O exposure.</Alert>}
          {view.usedBeforeConsent > 0 && <Alert>{view.usedBeforeConsent} use(s) recorded before consent — Article 39.B breach.</Alert>}
          {view.uninsuredUse && <Alert>Usage falls outside every active policy window — uninsured exposure.</Alert>}
          {view.activeStrikes > 0 && <Alert>{view.activeStrikes} active strike lock on this production.</Alert>}
          {view.policies.filter((pol) => pol.lapsed).map((pol) => (
            <Alert key={pol.id}>{LINE_LABEL[pol.policyLine]} policy lapsed (ended {fmtDate(pol.effectiveTo)}).</Alert>
          ))}
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-3">
        <Metric label="Cast onboarded" value={`${view.cast.consented}/${view.cast.total}`} />
        <Metric label="Coverage gaps" value={view.coverageGaps} alert={view.coverageGaps > 0} />
        <Metric label="Use violations" value={view.useViolations} alert={view.useViolations > 0} />
        <Metric label="Licences" value={view.licenceCount} />
      </div>

      {/* Cast onboarding breakdown */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>Cast onboarding</h2>
        <CastBar cast={view.cast} />
      </section>

      {/* Policy panel */}
      <PolicyPanel view={view} onChange={onPolicyChange} />

      {/* Evidence link */}
      <a
        href={`/evidence`}
        className="inline-block text-xs font-medium px-3 py-2 rounded border"
        style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
      >
        View full consent &amp; custody evidence →
      </a>
    </div>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return <div className="text-sm" style={{ color: "#c0392b" }}>• {children}</div>;
}

function CastBar({ cast }: { cast: CastSummary }) {
  const segs = [
    { key: "consented", label: "Consented", n: cast.consented, c: "#166534" },
    { key: "linked", label: "Linked", n: cast.linked, c: "#3f6212" },
    { key: "invited", label: "Invited", n: cast.invited, c: "#92400e" },
    { key: "placeholder", label: "Placeholder", n: cast.placeholder, c: "#a8a29e" },
    { key: "declined", label: "Declined", n: cast.declined, c: "#c0392b" },
  ].filter((s) => s.n > 0);
  const total = cast.total || 1;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded" style={{ background: "var(--color-border)" }}>
        {segs.map((s) => (
          <div key={s.key} style={{ width: `${(s.n / total) * 100}%`, background: s.c }} title={`${s.label}: ${s.n}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segs.map((s) => (
          <span key={s.key} className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--color-muted)" }}>
            <span className="w-2 h-2 rounded-full" style={{ background: s.c }} />{s.label} {s.n}
          </span>
        ))}
        {cast.total === 0 && <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>No cast recorded.</span>}
      </div>
    </div>
  );
}

function PolicyPanel({ view, onChange }: { view: UnderwritingView; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ policyLine: "eo" as PolicyLine, policyNumber: "", coverageLimit: "", currency: "USD", effectiveFrom: "", effectiveTo: "", notes: "" });

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/insurer/productions/${view.production.id}/policies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyLine: form.policyLine,
          policyNumber: form.policyNumber || undefined,
          coverageLimit: form.coverageLimit ? Number(form.coverageLimit) : undefined,
          currency: form.currency || undefined,
          effectiveFrom: dateToEpoch(form.effectiveFrom),
          effectiveTo: dateToEpoch(form.effectiveTo),
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(d.error ?? "Failed to save policy."); return;
      }
      setAdding(false);
      setForm({ policyLine: "eo", policyNumber: "", coverageLimit: "", currency: "USD", effectiveFrom: "", effectiveTo: "", notes: "" });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/insurer/productions/${view.production.id}/policies/${id}`, { method: "DELETE" });
      if (res.ok) onChange();
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "w-full text-sm px-2.5 py-1.5 rounded border bg-transparent";
  const inputStyle = { borderColor: "var(--color-border)", color: "var(--color-ink)" } as const;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Policies</h2>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-xs font-medium" style={{ color: "var(--color-accent)" }}>+ Record policy</button>
        )}
      </div>

      {view.policies.length === 0 && !adding && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No policy recorded for this production.</p>
      )}

      {view.policies.length > 0 && (
        <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
          {view.policies.map((pol) => (
            <div key={pol.id} className="px-4 py-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
                  {LINE_LABEL[pol.policyLine]}
                  {pol.policyNumber && <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>#{pol.policyNumber}</span>}
                  {pol.lapsed && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded" style={{ background: "rgba(192,57,43,0.12)", color: "#c0392b" }}>Lapsed</span>}
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                  Limit {fmtMoney(pol.coverageLimit, pol.currency)} · {fmtDate(pol.effectiveFrom)} → {fmtDate(pol.effectiveTo)}
                </div>
                {pol.notes && <div className="text-[11px] mt-1" style={{ color: "var(--color-muted)" }}>{pol.notes}</div>}
              </div>
              <button onClick={() => void archive(pol.id)} disabled={busy} className="text-[11px] shrink-0" style={{ color: "var(--color-muted)" }}>Archive</button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="rounded border p-4 mt-2 space-y-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>Policy line</span>
              <select value={form.policyLine} onChange={(e) => setForm({ ...form, policyLine: e.target.value as PolicyLine })} className={inputCls} style={inputStyle}>
                <option value="eo">E&amp;O</option>
                <option value="cyber">Cyber / privacy</option>
                <option value="completion_bond">Completion bond</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>Policy number</span>
              <input value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} className={inputCls} style={inputStyle} placeholder="optional" />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>Coverage limit</span>
              <input type="number" min={0} value={form.coverageLimit} onChange={(e) => setForm({ ...form, coverageLimit: e.target.value })} className={inputCls} style={inputStyle} placeholder="e.g. 5000000" />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>Currency</span>
              <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={inputCls} style={inputStyle} maxLength={3} />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>Effective from</span>
              <input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} className={inputCls} style={inputStyle} />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>Effective to</span>
              <input type="date" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} className={inputCls} style={inputStyle} />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>Notes</span>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} style={inputStyle} placeholder="optional" />
          </label>
          {err && <p className="text-xs" style={{ color: "#c0392b" }}>{err}</p>}
          <div className="flex items-center gap-2">
            <button onClick={() => void submit()} disabled={busy} className="text-xs font-medium px-3 py-1.5 rounded" style={{ background: "var(--color-accent)", color: "#fff" }}>{busy ? "Saving…" : "Save policy"}</button>
            <button onClick={() => { setAdding(false); setErr(null); }} disabled={busy} className="text-xs" style={{ color: "var(--color-muted)" }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
