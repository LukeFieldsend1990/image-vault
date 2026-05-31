"use client";

import { useState, useCallback } from "react";

export interface FingerprintFileRow {
  id: string;
  fileId: string;
  filename: string;
  status: string;
  error: string | null;
  createdAt: number;
}

export interface JobRow {
  id: string;
  licenceId: string;
  licenseeEmail: string;
  packageName: string;
  status: string;
  filesTotal: number | null;
  filesDone: number;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  fingerprints: FingerprintFileRow[];
}

// CF queue consumers have a 15-minute wall clock limit. Jobs stuck in
// processing beyond this are almost certainly dead (OOM/timeout).
const STALL_THRESHOLD_SECS = 15 * 60;

const JOB_COLOR: Record<string, { bg: string; fg: string }> = {
  queued:     { bg: "rgba(217,119,6,0.12)",  fg: "#d97706" },
  processing: { bg: "rgba(37,99,235,0.12)",  fg: "#2563eb" },
  stalled:    { bg: "rgba(217,119,6,0.15)",  fg: "#b45309" },
  complete:   { bg: "rgba(22,101,52,0.12)",  fg: "#166534" },
  failed:     { bg: "rgba(153,27,27,0.12)",  fg: "#991b1b" },
};

const FP_COLOR: Record<string, { bg: string; fg: string }> = {
  ready:   { bg: "rgba(22,101,52,0.12)",  fg: "#166534" },
  pending: { bg: "rgba(217,119,6,0.12)",  fg: "#d97706" },
  failed:  { bg: "rgba(153,27,27,0.12)",  fg: "#991b1b" },
};

function duration(from: number, to: number | null): string {
  const secs = (to ?? Math.floor(Date.now() / 1000)) - from;
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusPill({ status, small }: { status: string; small?: boolean }) {
  const c = JOB_COLOR[status] ?? { bg: "rgba(107,114,128,0.12)", fg: "#6b7280" };
  return (
    <span
      className="uppercase tracking-wide font-semibold rounded shrink-0 whitespace-nowrap"
      style={{
        background: c.bg,
        color: c.fg,
        fontSize: small ? 9 : 9,
        padding: small ? "2px 6px" : "2px 7px",
      }}
    >
      {status}
    </span>
  );
}

export default function GeoFingerprintJobsTable({ jobs }: { jobs: JobRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rerunning, setRerunning] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rerun = useCallback(async (e: React.MouseEvent, licenceId: string, jobId: string) => {
    e.stopPropagation();
    setRerunning((prev) => new Set(prev).add(jobId));
    try {
      await fetch("/api/admin/geometry-fingerprints/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenceId }),
      });
      window.location.reload();
    } catch {
      setRerunning((prev) => { const n = new Set(prev); n.delete(jobId); return n; });
    }
  }, []);

  if (jobs.length === 0) {
    return (
      <p className="px-5 py-4 text-xs" style={{ color: "var(--color-muted)" }}>
        No jobs yet. Jobs are created automatically when a licence is approved.
      </p>
    );
  }

  return (
    <div>
      {jobs.map((job) => {
        const isOpen = expanded.has(job.id);
        const pct =
          job.filesTotal && job.filesTotal > 0
            ? Math.round((job.filesDone / job.filesTotal) * 100)
            : null;
        const elapsedSecs = (job.completedAt ?? Math.floor(Date.now() / 1000)) - job.createdAt;
        const isStalled = job.status === "processing" && elapsedSecs > STALL_THRESHOLD_SECS;
        const displayStatus = isStalled ? "stalled" : job.status;
        const isRunning = job.status === "processing" || job.status === "queued";
        const dur = duration(job.createdAt, job.completedAt);
        const barColor =
          job.status === "failed" || isStalled
            ? "#991b1b"
            : job.status === "complete"
            ? "#166534"
            : "#2563eb";

        return (
          <div
            key={job.id}
            className="border-b last:border-0"
            style={{ borderColor: "var(--color-border)" }}
          >
            {/* Clickable header row */}
            <button
              onClick={() => toggle(job.id)}
              className="w-full text-left transition-colors"
              style={{ background: isOpen ? "var(--color-surface)" : "transparent" }}
            >
              <div className="px-5 py-3.5 flex items-start gap-4">
                {/* Status */}
                <div className="pt-0.5 shrink-0">
                  <StatusPill status={displayStatus} />
                </div>

                {/* Licence / licensee / package */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
                      {job.licenseeEmail}
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                      · {job.packageName}
                    </span>
                  </div>
                  <p
                    className="text-[11px] font-mono mt-0.5 truncate"
                    style={{ color: "var(--color-muted)" }}
                  >
                    {job.licenceId}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                    {ts(job.createdAt)}
                    {job.completedAt
                      ? ` · ${dur}`
                      : isRunning
                      ? ` · running ${dur}`
                      : ""}
                  </p>
                </div>

                {/* Progress + re-run */}
                <div className="shrink-0 text-right">
                  <p
                    className="text-[11px] tabular-nums"
                    style={{ color: "var(--color-muted)" }}
                  >
                    {job.filesDone}/{job.filesTotal ?? "?"} files
                  </p>
                  {pct !== null && (
                    <div
                      className="mt-1.5 rounded-full overflow-hidden"
                      style={{ height: 3, width: 72, background: "var(--color-border)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: barColor }}
                      />
                    </div>
                  )}
                  {job.status !== "queued" && (
                    <button
                      onClick={(e) => void rerun(e, job.licenceId, job.id)}
                      disabled={rerunning.has(job.id)}
                      className="mt-2 text-[10px] font-semibold px-2 py-0.5 rounded transition disabled:opacity-40"
                      style={{
                        border: "1px solid rgba(37,99,235,0.3)",
                        color: "#2563eb",
                        background: "rgba(37,99,235,0.06)",
                      }}
                    >
                      {rerunning.has(job.id) ? "…" : "Re-run"}
                    </button>
                  )}
                </div>

                {/* Chevron */}
                <span
                  className="text-[10px] shrink-0 mt-0.5 select-none"
                  style={{ color: "var(--color-muted)" }}
                >
                  {isOpen ? "▲" : "▼"}
                </span>
              </div>

              {/* Inline job-level error */}
              {job.status === "failed" && job.error && (
                <div
                  className="mx-5 mb-3 px-3 py-2 rounded text-[11px] font-mono text-left"
                  style={{ background: "rgba(153,27,27,0.06)", color: "#991b1b", border: "1px solid rgba(153,27,27,0.2)" }}
                >
                  {job.error}
                </div>
              )}

              {/* Stall warning — worker crashed (OOM/timeout) without recording an error */}
              {isStalled && (
                <div
                  className="mx-5 mb-3 px-3 py-2 rounded text-[11px] text-left"
                  style={{ background: "rgba(180,83,9,0.06)", color: "#b45309", border: "1px solid rgba(180,83,9,0.2)" }}
                >
                  Worker timed out or ran out of memory — no error was recorded. Hit Re-run to try again.
                </div>
              )}
            </button>

            {/* Expanded: per-file fingerprint rows */}
            {isOpen && (
              <div
                className="border-t"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-surface)",
                }}
              >
                {/* Column header */}
                <div
                  className="px-8 py-1.5 flex items-center justify-between text-[10px] uppercase tracking-widest font-semibold border-b"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
                >
                  <span>File</span>
                  <div className="flex items-center gap-4">
                    <span>Downloads</span>
                    <span>Status</span>
                  </div>
                </div>

                {job.fingerprints.length === 0 ? (
                  <p className="px-8 py-3 text-[11px]" style={{ color: "var(--color-muted)" }}>
                    No file records yet.
                  </p>
                ) : (
                  job.fingerprints.map((fp) => {
                    const fc =
                      FP_COLOR[fp.status] ?? {
                        bg: "rgba(107,114,128,0.12)",
                        fg: "#6b7280",
                      };
                    return (
                      <div
                        key={fp.id}
                        className="px-8 py-2.5 border-b last:border-0"
                        style={{ borderColor: "var(--color-border)" }}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p
                              className="text-[11px] font-mono truncate"
                              style={{ color: "var(--color-ink)" }}
                            >
                              {fp.filename}
                            </p>
                            {fp.error && (
                              <p
                                className="text-[11px] font-mono mt-0.5"
                                style={{ color: "#991b1b" }}
                              >
                                {fp.error}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {fp.status === "ready" && (
                              <div className="flex items-center gap-1.5">
                                <a
                                  href={`/api/admin/geometry-fingerprints/download?fingerprintId=${fp.id}&type=original`}
                                  download
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded"
                                  style={{ border: "1px solid rgba(107,114,128,0.3)", color: "#6b7280", background: "rgba(107,114,128,0.06)" }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Original
                                </a>
                                <a
                                  href={`/api/admin/geometry-fingerprints/download?fingerprintId=${fp.id}&type=watermarked`}
                                  download
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded"
                                  style={{ border: "1px solid rgba(5,150,105,0.3)", color: "#059669", background: "rgba(5,150,105,0.06)" }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Watermarked
                                </a>
                              </div>
                            )}
                            <span
                              className="uppercase tracking-wide font-semibold rounded"
                              style={{
                                background: fc.bg,
                                color: fc.fg,
                                fontSize: 9,
                                padding: "2px 6px",
                              }}
                            >
                              {fp.status}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
