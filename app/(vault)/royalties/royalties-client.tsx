"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

// ── Types ───────────────────────────────────────────────────────────────────
interface SourceBreakdown { sourceId: string; name: string; pence: number; events: number }
interface TypeBreakdown { type: string; pence: number; events: number }
interface FeedEvent {
  id: string; source: string; units: number; eventType: string;
  talentPence: number; occurredAt: number; recordedAt: number;
}
interface Summary {
  currency: string;
  lifetimePence: number; eventCount: number; todayPence: number; last24hPence: number;
  bySource: SourceBreakdown[]; byUsageType: TypeBreakdown[];
  sparkline: number[]; recent: FeedEvent[];
}
interface Source {
  id: string; licenceId: string; displayName: string;
  unitType: string; unitRatePence: number; status: string;
  lastUsedAt: number | null; createdAt: number; revokedAt: number | null;
}
interface EligibleLicence { id: string; projectName: string; productionCompany: string; licenceType: string | null }

// ── Helpers ───────────────────────────────────────────────────────────────────
const ARC_COLORS = ["#c0392b", "#d97706", "#2563eb", "#059669", "#7c3aed", "#db2777", "#0891b2", "#65a30d"];

const UNIT_LABELS: Record<string, string> = {
  per_generation: "per generation",
  per_1k_inferences: "per 1k inferences",
  per_frame: "per frame",
  per_second: "per second",
};

function gbp(pence: number): string {
  return "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function relTime(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Count-up animated number ────────────────────────────────────────────────
function CountUp({ pence }: { pence: number }) {
  const [display, setDisplay] = useState(pence);
  const fromRef = useRef(pence);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = pence;
    if (from === to) return;
    const start = performance.now();
    const dur = 800;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [pence]);

  return <>{gbp(display)}</>;
}

// ── Donut hub ──────────────────────────────────────────────────────────────
function RoyaltyHub({ summary, pulse }: { summary: Summary; pulse: number }) {
  const R = 80;
  const C = 2 * Math.PI * R;
  const total = summary.bySource.reduce((a, s) => a + s.pence, 0);

  // Prefix sums give each segment's start without mutating a render-scoped var.
  const fracs = summary.bySource.map((s) => (total > 0 ? s.pence / total : 0));
  const segments = summary.bySource.map((_s, i) => {
    const len = fracs[i] * C;
    const startLen = fracs.slice(0, i).reduce((a, f) => a + f, 0) * C;
    return { color: ARC_COLORS[i % ARC_COLORS.length], dash: len, gap: C - len, rotation: (startLen / C) * 360 };
  });

  return (
    <div className="relative flex items-center justify-center" style={{ width: 220, height: 220 }}>
      <svg width={220} height={220} viewBox="0 0 220 220" style={{ transform: "rotate(-90deg)" }}>
        {/* Track */}
        <circle cx={110} cy={110} r={R} fill="none" stroke="var(--color-border)" strokeWidth={14} />
        {/* Source segments */}
        {segments.map((seg, i) => (
          <circle
            key={i}
            cx={110} cy={110} r={R} fill="none"
            stroke={seg.color} strokeWidth={14} strokeLinecap="butt"
            strokeDasharray={`${seg.dash} ${seg.gap}`}
            strokeDashoffset={-((seg.rotation / 360) * C)}
            style={{ transition: "stroke-dasharray 0.7s ease, stroke-dashoffset 0.7s ease" }}
          />
        ))}
        {/* Pulse ring — retriggers via key on new events */}
        {total > 0 && (
          <circle
            key={pulse} cx={110} cy={110} r={R + 16} fill="none"
            stroke="var(--color-accent)" strokeWidth={2}
            className="royalty-pulse"
          />
        )}
      </svg>
      {/* Centre readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
        <p className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: "var(--color-muted)" }}>
          Lifetime
        </p>
        <p className="text-2xl font-semibold tracking-tight tabular-nums" style={{ color: "var(--color-ink)" }}>
          <CountUp pence={summary.lifetimePence} />
        </p>
        <p className="text-[10px] mt-0.5" style={{ color: "var(--color-muted)" }}>
          {summary.eventCount.toLocaleString("en-GB")} generations
        </p>
      </div>
    </div>
  );
}

// ── Sparkline (24 hourly buckets) ────────────────────────────────────────────
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-[3px]" style={{ height: 48 }}>
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t"
          style={{
            height: `${Math.max(2, (v / max) * 100)}%`,
            background: v > 0 ? "var(--color-accent)" : "var(--color-border)",
            opacity: v > 0 ? 0.85 : 0.4,
            transition: "height 0.5s ease",
          }}
          title={gbp(v)}
        />
      ))}
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>{label}</p>
      <p className="text-xl font-semibold tracking-tight tabular-nums" style={{ color: "var(--color-ink)" }}>{value}</p>
      {sub && <p className="text-[11px] mt-1" style={{ color: "var(--color-muted)" }}>{sub}</p>}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function RoyaltiesClient() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [eligible, setEligible] = useState<EligibleLicence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const prevCount = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/royalties/summary");
      if (!res.ok) throw new Error();
      const d = (await res.json()) as Summary;
      setSummary(d);
      if (prevCount.current !== null && d.eventCount > prevCount.current) setPulse((p) => p + 1);
      prevCount.current = d.eventCount;
    } catch {
      setError("Could not load royalty data.");
    }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const res = await fetch("/api/royalties/sources");
      if (!res.ok) return;
      const d = (await res.json()) as { sources: Source[]; eligibleLicences: EligibleLicence[] };
      setSources(d.sources);
      setEligible(d.eligibleLicences);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    loadSummary();
    loadSources();
    intervalRef.current = setInterval(loadSummary, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [loadSummary, loadSources]);

  async function createSource(form: FormData) {
    setBusy(true);
    try {
      const pounds = parseFloat(String(form.get("rate") ?? "0"));
      const res = await fetch("/api/royalties/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          licenceId: form.get("licenceId"),
          displayName: form.get("displayName"),
          unitType: form.get("unitType"),
          unitRatePence: Math.round(pounds * 100),
        }),
      });
      const d = (await res.json()) as { key?: string; error?: string };
      if (!res.ok) { setError(d.error ?? "Could not create source."); return; }
      setIssuedKey(d.key ?? null);
      setShowForm(false);
      await loadSources();
    } finally { setBusy(false); }
  }

  async function revokeSource(id: string) {
    await fetch(`/api/royalties/sources/${id}`, { method: "DELETE" });
    await loadSources();
  }

  async function fireDemo(id: string) {
    setBusy(true);
    try {
      await fetch("/api/royalties/demo/fire", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: id, count: 5 }),
      });
      await loadSummary();
    } finally { setBusy(false); }
  }

  if (error && !summary) {
    return <div className="p-8 text-sm" style={{ color: "var(--color-danger)" }}>{error}</div>;
  }
  if (!summary) {
    return <div className="p-8 text-sm" style={{ color: "var(--color-muted)" }}>Loading…</div>;
  }

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
          Live Royalty Meter
        </p>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Royalty Hub</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Pay-as-you-go earnings as your likeness drives AI generation. Updates live.
        </p>
      </div>

      {/* Hub + stats */}
      <div className="grid gap-6 lg:grid-cols-[260px_1fr] items-start mb-8">
        <div className="rounded border p-6 flex flex-col items-center" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <RoyaltyHub summary={summary} pulse={pulse} />
          <div className="flex items-center gap-1.5 mt-4 text-[11px]" style={{ color: "var(--color-muted)" }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full royalty-live-dot" style={{ background: "#059669" }} />
            Live
          </div>
        </div>

        <div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Today" value={gbp(summary.todayPence)} />
            <Stat label="Last 24h" value={gbp(summary.last24hPence)} />
            <Stat label="Lifetime" value={gbp(summary.lifetimePence)} />
            <Stat label="Generations" value={summary.eventCount.toLocaleString("en-GB")} />
          </div>
          <div className="rounded border p-4 mt-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--color-muted)" }}>
              Last 24 hours
            </p>
            <Sparkline data={summary.sparkline} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Live feed */}
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--color-muted)" }}>
            Live usage feed
          </p>
          {summary.recent.length === 0 ? (
            <p className="text-sm rounded border p-4" style={{ color: "var(--color-muted)", borderColor: "var(--color-border)" }}>
              No usage yet. Connect a studio source below to start metering.
            </p>
          ) : (
            <div className="space-y-1.5">
              {summary.recent.map((e) => (
                <div
                  key={e.id}
                  className="royalty-feed-row flex items-center justify-between rounded border px-3 py-2"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>{e.source}</p>
                    <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                      {e.units.toLocaleString("en-GB")} × {UNIT_LABELS[e.eventType] ?? e.eventType} · {relTime(e.recordedAt)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0 ml-3" style={{ color: "#059669" }}>
                    +{gbp(e.talentPence)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Source breakdown legend */}
          {summary.bySource.length > 0 && (
            <div className="mt-5">
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
                By source
              </p>
              <div className="space-y-1.5">
                {summary.bySource.map((s, i) => (
                  <div key={s.sourceId} className="flex items-center gap-2 text-sm">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ARC_COLORS[i % ARC_COLORS.length] }} />
                    <span className="truncate flex-1" style={{ color: "var(--color-text)" }}>{s.name}</span>
                    <span className="tabular-nums" style={{ color: "var(--color-muted)" }}>{s.events.toLocaleString("en-GB")}</span>
                    <span className="tabular-nums font-medium w-20 text-right" style={{ color: "var(--color-ink)" }}>{gbp(s.pence)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Source management */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--color-muted)" }}>
              Connected sources
            </p>
            {eligible.length > 0 && (
              <button
                onClick={() => { setShowForm((v) => !v); setIssuedKey(null); }}
                className="text-[11px] font-medium underline"
                style={{ color: "var(--color-accent)" }}
              >
                {showForm ? "Cancel" : "+ Add source"}
              </button>
            )}
          </div>

          {/* Issued key (shown once) */}
          {issuedKey && (
            <div className="rounded border p-3 mb-3" style={{ borderColor: "var(--color-accent)", background: "rgba(192,57,43,0.06)" }}>
              <p className="text-[11px] font-medium mb-1" style={{ color: "var(--color-accent)" }}>
                Copy this key now — it won&apos;t be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="text-[11px] break-all flex-1" style={{ color: "var(--color-ink)" }}>{issuedKey}</code>
                <button
                  onClick={() => navigator.clipboard?.writeText(issuedKey)}
                  className="text-[11px] underline shrink-0"
                  style={{ color: "var(--color-accent)" }}
                >Copy</button>
              </div>
            </div>
          )}

          {/* New source form */}
          {showForm && (
            <form
              action={createSource}
              className="rounded border p-4 mb-3 space-y-3"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div>
                <label className="text-[10px] uppercase tracking-widest font-semibold block mb-1" style={{ color: "var(--color-muted)" }}>Licence</label>
                <select name="licenceId" required className="w-full text-sm rounded border px-2 py-1.5 bg-white" style={{ borderColor: "var(--color-border)" }}>
                  {eligible.map((l) => (
                    <option key={l.id} value={l.id}>{l.projectName} — {l.productionCompany}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-semibold block mb-1" style={{ color: "var(--color-muted)" }}>Source name</label>
                <input name="displayName" required maxLength={120} placeholder="e.g. Pixel Forge VFX — Unreal pipeline"
                  className="w-full text-sm rounded border px-2 py-1.5 bg-white" style={{ borderColor: "var(--color-border)" }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-semibold block mb-1" style={{ color: "var(--color-muted)" }}>Unit type</label>
                  <select name="unitType" className="w-full text-sm rounded border px-2 py-1.5 bg-white" style={{ borderColor: "var(--color-border)" }}>
                    <option value="per_generation">per generation</option>
                    <option value="per_1k_inferences">per 1k inferences</option>
                    <option value="per_frame">per frame</option>
                    <option value="per_second">per second</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-semibold block mb-1" style={{ color: "var(--color-muted)" }}>Rate (£/unit)</label>
                  <input name="rate" required type="number" step="0.01" min="0.01" placeholder="0.05"
                    className="w-full text-sm rounded border px-2 py-1.5 bg-white" style={{ borderColor: "var(--color-border)" }} />
                </div>
              </div>
              <button type="submit" disabled={busy}
                className="btn-accent text-white text-sm font-medium px-4 py-2 rounded w-full disabled:opacity-50">
                {busy ? "Issuing…" : "Issue source key"}
              </button>
            </form>
          )}

          {sources.length === 0 ? (
            <p className="text-sm rounded border p-4" style={{ color: "var(--color-muted)", borderColor: "var(--color-border)" }}>
              {eligible.length === 0
                ? "No AI-bearing approved licences yet. Royalty sources attach to an approved AI/avatar or training-data licence."
                : "No sources connected. Add one to issue a webhook key."}
            </p>
          ) : (
            <div className="space-y-2">
              {sources.map((s) => {
                const revoked = s.status === "revoked";
                return (
                  <div key={s.id} className="rounded border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", opacity: revoked ? 0.55 : 1 }}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>{s.displayName}</p>
                      <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: revoked ? "rgba(120,120,120,0.15)" : "rgba(5,150,105,0.12)", color: revoked ? "var(--color-muted)" : "#059669" }}>
                        {s.status}
                      </span>
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: "var(--color-muted)" }}>
                      {gbp(s.unitRatePence)} {UNIT_LABELS[s.unitType] ?? s.unitType}
                      {s.lastUsedAt ? ` · last used ${relTime(s.lastUsedAt)}` : " · never used"}
                    </p>
                    {!revoked && (
                      <div className="flex items-center gap-3 mt-2">
                        <button onClick={() => fireDemo(s.id)} disabled={busy}
                          className="text-[11px] font-medium underline disabled:opacity-50" style={{ color: "var(--color-accent)" }}>
                          Fire demo events
                        </button>
                        <button onClick={() => revokeSource(s.id)}
                          className="text-[11px] underline" style={{ color: "var(--color-muted)" }}>
                          Revoke
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[11px] mt-4 leading-relaxed" style={{ color: "var(--color-muted)" }}>
            Studios POST to <code style={{ color: "var(--color-text)" }}>/api/royalties/usage</code> with the source key on each
            generation. Earnings split <Link href="/settings" className="underline">per your share settings</Link> and land here live.
          </p>
        </div>
      </div>
    </div>
  );
}
