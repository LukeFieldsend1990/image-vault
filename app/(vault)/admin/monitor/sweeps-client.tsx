"use client";

import { useEffect, useState } from "react";

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

export default function SweepsClient() {
  const [runs, setRuns] = useState<SweepRun[] | null>(null);

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
          failed. Runs that stop reporting are marked failed after 15 minutes.
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
                {["Started", "Talent", "Trigger", "Duration", "Candidates", "Hits", "Status"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left font-medium tracking-widest uppercase"
                    style={{ color: "var(--color-muted)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const s = STATUS_STYLE[run.status];
                return (
                  <tr key={run.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
