"use client";

import { useEffect, useState } from "react";

interface Totals {
  byStatus: Record<string, number>;
  dismissalReasons: Record<string, number>;
  whitelistReasons: Record<string, number>;
  adjudicated: number;
  confirmed: number;
  dismissed: number;
  whitelistedAccounts: number;
  precision: number | null;
}

interface CalibrationRow {
  label: string;
  count: number;
  avgConfidence: number;
  avgAiLikelihood: number;
}

interface TalentRow {
  talentId: string;
  name: string;
  total: number;
  pending: number;
  confirmed: number;
  dismissed: number;
  dismissedNotMe: number;
  dismissedNotAi: number;
  dismissedNotMisuse: number;
  whitelistedAccounts: number;
  whitelistedFalsePositives: number;
  precision: number | null;
  avgConfidenceConfirmed: number | null;
  avgConfidenceDismissed: number | null;
  lastAdjudicatedAt: number | null;
}

interface FeedbackData {
  totals: Totals;
  calibration: CalibrationRow[];
  talents: TalentRow[];
}

const VERDICT_LABELS: Record<string, string> = {
  confirmed: "Confirmed abuse",
  "dismissed:not_me": "Dismissed — not the talent",
  "dismissed:not_ai": "Dismissed — not AI-generated",
  "dismissed:not_misuse": "Dismissed — not misuse",
  "dismissed:other": "Dismissed — other",
};

const WHITELIST_LABELS: Record<string, string> = {
  false_positive: "False positive",
  fan_fluff: "Harmless fan content",
  talent_approved: "Talent approved",
  other: "Other",
};

function when(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function FeedbackClient() {
  const [data, setData] = useState<FeedbackData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin/monitor/feedback");
      if (cancelled) return;
      if (!res.ok) {
        setError(true);
        return;
      }
      const body = (await res.json()) as FeedbackData;
      if (!cancelled) setData(body);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
            Detection feedback
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
            Human verdicts on scan hits — confirmed, dismissed, whitelisted — read back as a tuning
            signal for the deepfake detection model, split per talent.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <a
            href="/api/admin/monitor/feedback/export?format=jsonl"
            className="rounded px-3 py-1.5 text-xs font-medium"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
          >
            Export JSONL
          </a>
          <a
            href="/api/admin/monitor/feedback/export"
            className="rounded px-3 py-1.5 text-xs font-medium"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
          >
            Export JSON
          </a>
        </div>
      </div>

      {error ? (
        <div className="text-xs" style={{ color: "var(--color-accent)" }}>
          Failed to load feedback data.
        </div>
      ) : data === null ? (
        <div className="text-xs" style={{ color: "var(--color-muted)" }}>
          Loading…
        </div>
      ) : data.totals.adjudicated === 0 && data.totals.whitelistedAccounts === 0 ? (
        <div
          className="rounded p-6 text-sm text-center"
          style={{ border: "1px dashed var(--color-border)", color: "var(--color-muted)" }}
        >
          No adjudicated hits yet. Once talent or reps confirm or dismiss monitor hits (or whitelist
          accounts), the verdicts aggregate here.
        </div>
      ) : (
        <>
          <StatRow totals={data.totals} />
          <CalibrationTable rows={data.calibration} />
          <ReasonBreakdowns totals={data.totals} />
          <TalentTable talents={data.talents} />
        </>
      )}
    </section>
  );
}

function StatRow({ totals }: { totals: Totals }) {
  const stats: Array<{ label: string; value: string }> = [
    { label: "Adjudicated", value: String(totals.adjudicated) },
    { label: "Confirmed abuse", value: String(totals.confirmed) },
    { label: "Dismissed", value: String(totals.dismissed) },
    { label: "Whitelisted accounts", value: String(totals.whitelistedAccounts) },
    { label: "Precision", value: totals.precision === null ? "—" : `${totals.precision}%` },
    { label: "Awaiting verdict", value: String(totals.byStatus.new ?? 0) },
  ];
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded p-3"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
            {s.value}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function CalibrationTable({ rows }: { rows: CalibrationRow[] }) {
  if (rows.length === 0) return null;
  const order = Object.keys(VERDICT_LABELS);
  const sorted = [...rows].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  return (
    <div className="rounded overflow-x-auto" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
      <div className="px-4 pt-3">
        <h3 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Detector calibration by verdict
        </h3>
        <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
          High likeness confidence on &ldquo;not the talent&rdquo; means the matcher is over-confident;
          high AI likelihood on &ldquo;not AI-generated&rdquo; means the synthetic check is.
        </p>
      </div>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-xs" style={{ color: "var(--color-muted)" }}>
            <th className="px-4 py-2 font-medium">Verdict</th>
            <th className="px-4 py-2 font-medium text-right">Hits</th>
            <th className="px-4 py-2 font-medium text-right">Avg likeness confidence</th>
            <th className="px-4 py-2 font-medium text-right">Avg AI likelihood</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.label} style={{ borderTop: "1px solid var(--color-border)" }}>
              <td className="px-4 py-2" style={{ color: "var(--color-ink)" }}>
                {VERDICT_LABELS[r.label] ?? r.label}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: "var(--color-ink)" }}>
                {r.count}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: "var(--color-ink)" }}>
                {r.avgConfidence}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: "var(--color-ink)" }}>
                {r.avgAiLikelihood}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReasonBreakdowns({ totals }: { totals: Totals }) {
  const dismissals = Object.entries(totals.dismissalReasons);
  const whitelists = Object.entries(totals.whitelistReasons);
  if (dismissals.length === 0 && whitelists.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ReasonCard
        title="Dismissal reasons"
        entries={dismissals.map(([k, v]) => ({
          label:
            k === "not_me"
              ? "Not the talent"
              : k === "not_ai"
                ? "Not AI-generated"
                : k === "not_misuse"
                  ? "Not misuse"
                  : "Other",
          count: v,
        }))}
        total={totals.dismissed}
      />
      <ReasonCard
        title="Whitelist reasons"
        entries={whitelists.map(([k, v]) => ({ label: WHITELIST_LABELS[k] ?? k, count: v }))}
        total={totals.whitelistedAccounts}
      />
    </div>
  );
}

function ReasonCard({
  title,
  entries,
  total,
}: {
  title: string;
  entries: Array<{ label: string; count: number }>;
  total: number;
}) {
  return (
    <div className="rounded p-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
      <h3 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
        {title}
      </h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs" style={{ color: "var(--color-muted)" }}>
          None yet.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {entries
            .sort((a, b) => b.count - a.count)
            .map((e) => (
              <li key={e.label} className="flex items-center gap-2 text-xs">
                <span className="w-32 shrink-0" style={{ color: "var(--color-ink)" }}>
                  {e.label}
                </span>
                <span className="h-1.5 flex-1 rounded overflow-hidden" style={{ background: "var(--color-bg)" }}>
                  <span
                    className="block h-full rounded"
                    style={{
                      background: "var(--color-accent)",
                      width: `${total > 0 ? Math.max(4, Math.round((e.count / total) * 100)) : 0}%`,
                    }}
                  />
                </span>
                <span className="w-8 text-right font-mono" style={{ color: "var(--color-muted)" }}>
                  {e.count}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function TalentTable({ talents }: { talents: TalentRow[] }) {
  if (talents.length === 0) return null;
  return (
    <div className="rounded overflow-x-auto" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
      <div className="px-4 pt-3">
        <h3 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Per-talent breakdown
        </h3>
      </div>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-xs" style={{ color: "var(--color-muted)" }}>
            <th className="px-4 py-2 font-medium">Talent</th>
            <th className="px-4 py-2 font-medium text-right">Hits</th>
            <th className="px-4 py-2 font-medium text-right">Confirmed</th>
            <th className="px-4 py-2 font-medium text-right">Dismissed</th>
            <th className="px-4 py-2 font-medium">Dismissal split</th>
            <th className="px-4 py-2 font-medium text-right">Whitelisted</th>
            <th className="px-4 py-2 font-medium text-right">Precision</th>
            <th className="px-4 py-2 font-medium text-right">Conf. avg (✓/✗)</th>
            <th className="px-4 py-2 font-medium text-right">Last verdict</th>
          </tr>
        </thead>
        <tbody>
          {talents.map((t) => (
            <tr key={t.talentId} style={{ borderTop: "1px solid var(--color-border)" }}>
              <td className="px-4 py-2 max-w-[180px] truncate" style={{ color: "var(--color-ink)" }}>
                {t.name}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: "var(--color-ink)" }}>
                {t.total}
                {t.pending > 0 && (
                  <span style={{ color: "var(--color-muted)" }}> ({t.pending} new)</span>
                )}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: "var(--color-accent)" }}>
                {t.confirmed}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: "var(--color-ink)" }}>
                {t.dismissed}
              </td>
              <td className="px-4 py-2 text-xs" style={{ color: "var(--color-muted)" }}>
                {t.dismissed === 0
                  ? "—"
                  : [
                      t.dismissedNotMe > 0 ? `${t.dismissedNotMe} not-me` : null,
                      t.dismissedNotAi > 0 ? `${t.dismissedNotAi} not-AI` : null,
                      t.dismissedNotMisuse > 0 ? `${t.dismissedNotMisuse} not-misuse` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "other"}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: "var(--color-ink)" }}>
                {t.whitelistedAccounts}
                {t.whitelistedFalsePositives > 0 && (
                  <span style={{ color: "var(--color-muted)" }}> ({t.whitelistedFalsePositives} FP)</span>
                )}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: "var(--color-ink)" }}>
                {t.precision === null ? "—" : `${t.precision}%`}
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: "var(--color-muted)" }}>
                {t.avgConfidenceConfirmed ?? "—"} / {t.avgConfidenceDismissed ?? "—"}
              </td>
              <td className="px-4 py-2 text-right text-xs" style={{ color: "var(--color-muted)" }}>
                {t.lastAdjudicatedAt ? when(t.lastAdjudicatedAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
