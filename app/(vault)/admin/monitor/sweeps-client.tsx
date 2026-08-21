"use client";

import { Fragment, useEffect, useState } from "react";
import { platformName } from "@/lib/monitor/platforms";
import { platformBrand } from "@/lib/monitor/platform-brand";

interface SweepQuery {
  platform: string;
  mode: string;
  query: string;
  resultCount: number | null;
  hitCount: number;
  costUsd: number;
  status: "succeeded" | "failed";
  error: string | null;
  fromLedger: boolean;
}

interface SweepRun {
  id: string;
  talentId: string;
  talentName: string;
  trigger: "manual" | "scheduled";
  status: "running" | "complete" | "error";
  platformsChecked: number;
  candidatesAnalysed: number;
  hitsFound: number;
  aiProvider: string | null;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
  queries: SweepQuery[];
}

function when(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function duration(run: SweepRun): string {
  const end = run.completedAt ?? Math.floor(Date.now() / 1000);
  const secs = Math.max(0, end - run.startedAt);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

const STATUS_STYLE: Record<SweepRun["status"], { color: string; label: string }> = {
  running: { color: "#d97706", label: "Running" },
  complete: { color: "#16a34a", label: "Complete" },
  error: { color: "#dc2626", label: "Failed" },
};

/**
 * How the term was asked for. The stored modes are the discovery layer's own
 * vocabulary ('getty_serp', 'x_search'); the platform column already says
 * which surface, so this only has to say what kind of lookup it was.
 */
function modeLabel(mode: string): string {
  if (mode === "account") return "account harvest";
  if (mode === "hashtag") return "hashtag";
  if (mode === "simulated") return "simulated";
  if (mode.endsWith("_serp")) return "web search";
  if (mode.endsWith("_search") || mode === "user_search") return "search";
  return mode;
}

/** Render the term the way the platform writes it: #tag, @handle, or plain text. */
function termLabel(q: SweepQuery): string {
  if (q.mode === "account") return `@${q.query.replace(/^@/, "")}`;
  if (q.mode === "hashtag" && !q.query.startsWith("#")) return `#${q.query}`;
  return q.query;
}

function QueryPanel({ queries }: { queries: SweepQuery[] }) {
  if (!queries.length) {
    return (
      <p className="px-4 py-3 text-xs" style={{ color: "var(--color-muted)" }}>
        No search terms recorded for this run — it stopped before any query was issued, or it
        predates query logging.
      </p>
    );
  }

  const ledgerOnly = queries.every((q) => q.fromLedger);
  const spend = queries.reduce((sum, q) => sum + q.costUsd, 0);

  return (
    <div className="px-4 py-3 space-y-2">
      <p className="text-xs" style={{ color: "var(--color-muted)" }}>
        {queries.length} search term{queries.length === 1 ? "" : "s"} issued
        {spend > 0 ? ` · $${spend.toFixed(4)} spent` : ""}
        {ledgerOnly
          ? " · reconstructed from the Apify spend ledger, so paid surfaces only"
          : ""}
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr>
            {["Platform", "Term", "Lookup", "Results", "Hits", "Cost"].map((h) => (
              <th
                key={h}
                className="py-1.5 pr-4 text-left font-medium tracking-widest uppercase"
                style={{ color: "var(--color-muted)" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {queries.map((q, i) => {
            const brand = platformBrand(q.platform);
            return (
              <tr key={`${q.platform}-${q.mode}-${q.query}-${i}`}>
                <td className="py-1.5 pr-4 whitespace-nowrap">
                  <span
                    className="rounded px-1.5 py-0.5"
                    style={{ color: brand.color, background: brand.tint }}
                  >
                    {platformName(q.platform)}
                  </span>
                </td>
                <td className="py-1.5 pr-4 font-mono" style={{ color: "var(--color-ink)" }}>
                  {termLabel(q)}
                  {q.status === "failed" && (
                    <span style={{ color: "#dc2626" }} title={q.error ?? "Query failed"}>
                      {" "}
                      failed{q.error ? ` (${q.error})` : ""}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-4 whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
                  {modeLabel(q.mode)}
                </td>
                <td className="py-1.5 pr-4 font-mono" style={{ color: "var(--color-text)" }}>
                  {q.resultCount === null ? "—" : q.resultCount}
                </td>
                <td
                  className="py-1.5 pr-4 font-mono"
                  style={{ color: q.hitCount > 0 ? "var(--color-accent)" : "var(--color-muted)" }}
                >
                  {q.hitCount}
                </td>
                <td className="py-1.5 pr-4 font-mono" style={{ color: "var(--color-muted)" }}>
                  {q.costUsd > 0 ? `$${q.costUsd.toFixed(4)}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs" style={{ color: "var(--color-muted)" }}>
        Results are raw items the surface returned, before the pre-filter. Hits are the ones that
        survived adjudication and landed in the talent&rsquo;s feed. A term that returns plenty and
        hits nothing is vocabulary to retire.
      </p>
    </div>
  );
}

export default function SweepsClient() {
  const [runs, setRuns] = useState<SweepRun[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Load once, then keep polling while anything is in flight so a pending run
  // resolves on screen instead of sitting at "Running" until a manual reload.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const res = await fetch("/api/admin/monitor/scans").catch(() => null);
      if (cancelled || !res?.ok) return;
      const data = (await res.json()) as { runs: SweepRun[] };
      if (cancelled) return;
      setRuns(data.runs);
      if (data.runs.some((r) => r.status === "running")) {
        timer = setTimeout(() => void tick(), 10_000);
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const pending = runs?.filter((r) => r.status === "running").length ?? 0;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Sweep runs
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Every discovery sweep across all talents — including runs still in flight and runs that
          failed. Runs that stop reporting are marked failed after 15 minutes. Open a run to see the
          hashtags and search terms it issued, and what each one returned.
          {pending > 0 && (
            <span style={{ color: "#d97706" }}>
              {" "}
              {pending} run{pending === 1 ? "" : "s"} in progress — refreshing automatically.
            </span>
          )}
        </p>
      </div>

      {runs === null ? (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Loading sweep runs…
        </p>
      ) : runs.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No sweeps have run yet.
        </p>
      ) : (
        <div
          className="rounded-md border overflow-x-auto"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["Started", "Talent", "Trigger", "Duration", "Terms", "Candidates", "Hits", "Status"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left font-medium tracking-widest uppercase"
                      style={{ color: "var(--color-muted)" }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const s = STATUS_STYLE[run.status];
                const open = expanded.has(run.id);
                const queries = run.queries ?? [];
                return (
                  <Fragment key={run.id}>
                    <tr
                      onClick={() => toggle(run.id)}
                      className="cursor-pointer"
                      style={{ borderTop: "1px solid var(--color-border)" }}
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
                        <span className="mr-1.5 inline-block font-mono">{open ? "▾" : "▸"}</span>
                        {when(run.startedAt)}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: "var(--color-ink)" }}>
                        {run.talentName}
                      </td>
                      <td className="px-4 py-2.5 capitalize" style={{ color: "var(--color-text)" }}>
                        {run.trigger}
                      </td>
                      <td className="px-4 py-2.5 font-mono whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                        {duration(run)}
                      </td>
                      <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                        {queries.length || "—"}
                      </td>
                      <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                        {run.status === "running" ? "—" : run.candidatesAnalysed}
                      </td>
                      <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                        {run.status === "running" ? "—" : run.hitsFound}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span style={{ color: s.color }} title={run.error ?? undefined}>
                          {s.label}
                          {run.status === "error" && run.error ? " ⓘ" : ""}
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr style={{ borderTop: "1px solid var(--color-border)" }}>
                        <td colSpan={8} style={{ background: "var(--color-bg)" }}>
                          <QueryPanel queries={queries} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
