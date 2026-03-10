"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Stage {
  id: string;
  jobId: string;
  stage: string;
  status: "pending" | "running" | "complete" | "failed" | "skipped";
  log: string | null;
  metadata: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

interface Output {
  id: string;
  sku: string;
  filename: string;
  sizeBytes: number;
}

interface Job {
  id: string;
  packageId: string;
  status: "queued" | "processing" | "complete" | "failed" | "cancelled";
  skus: string;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
}

interface JobDetail {
  job: Job;
  stages: Stage[];
  outputs: Output[];
  package: { id: string; name: string } | null;
}

const STAGE_LABELS: Record<string, string> = {
  validate: "Validate source files",
  classify: "Classify texture passes",
  assemble: "Generate Unreal manifest",
  bundle: "Build SKU bundles",
  notify: "Send notification",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "#9ca3af",
  running: "#d97706",
  complete: "#166534",
  failed: "#991b1b",
  skipped: "#6b7280",
  queued: "#d97706",
  processing: "#d97706",
  cancelled: "#6b7280",
};

const SKU_LABELS: Record<string, string> = {
  preview: "Preview Bundle",
  realtime: "Realtime Package",
  vfx: "VFX Package",
  training: "Training Data",
};

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + " KB";
  return n + " B";
}

function fmtDuration(a: number, b: number): string {
  const secs = b - a;
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function StageRow({ stage }: { stage: Stage }) {
  const [open, setOpen] = useState(false);
  const isActive = stage.status === "running";
  const color = STATUS_COLOR[stage.status];

  return (
    <div className="flex gap-4">
      {/* Timeline dot */}
      <div className="flex flex-col items-center">
        <div
          className="h-3 w-3 rounded-full shrink-0 mt-0.5"
          style={{
            background: color,
            boxShadow: isActive ? `0 0 0 3px ${color}22` : `0 0 0 2px ${color}44`,
          }}
        />
        <div className="flex-1 w-px mt-1" style={{ background: "var(--color-border)", minHeight: 16 }} />
      </div>

      {/* Content */}
      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {STAGE_LABELS[stage.stage] ?? stage.stage}
          </p>
          <span
            className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
            style={{ background: `${color}18`, color }}
          >
            {stage.status}
          </span>
          {stage.startedAt && stage.completedAt && (
            <span className="text-[10px]" style={{ color: "var(--color-muted)" }}>
              {fmtDuration(stage.startedAt, stage.completedAt)}
            </span>
          )}
        </div>

        {stage.log && (
          <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>{stage.log}</p>
        )}

        {stage.metadata && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-1 text-[10px] underline"
            style={{ color: "var(--color-accent)" }}
          >
            {open ? "Hide details" : "Show details"}
          </button>
        )}

        {open && stage.metadata && (
          <pre
            className="mt-2 text-[10px] p-2 rounded overflow-x-auto"
            style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
          >
            {JSON.stringify(JSON.parse(stage.metadata), null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export default function PipelineJobClient({ jobId }: { jobId: string }) {
  const [data, setData] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/pipeline/jobs/${jobId}`);
      if (!res.ok) throw new Error("Not found");
      const d = await res.json() as JobDetail;
      setData(d);
      // Stop polling once terminal state
      if (["complete", "failed", "cancelled"].includes(d.job.status)) {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } catch {
      setError("Could not load pipeline job.");
    }
  }

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  if (error) {
    return (
      <div className="p-8">
        <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>
        <Link href="/dashboard" className="mt-2 block text-sm underline" style={{ color: "var(--color-muted)" }}>← Dashboard</Link>
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-sm" style={{ color: "var(--color-muted)" }}>Loading…</div>;
  }

  const { job, stages, outputs } = data;
  const jobColor = STATUS_COLOR[job.status];

  const orderedStages = ["validate", "classify", "assemble", "bundle", "notify"]
    .map((name) => stages.find((s) => s.stage === name))
    .filter(Boolean) as Stage[];

  return (
    <div className="p-8 max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-xs" style={{ color: "var(--color-muted)" }}>
        <Link href="/dashboard" className="hover:underline">Dashboard</Link>
        <span>/</span>
        {data.package && (
          <>
            <span>{data.package.name}</span>
            <span>/</span>
          </>
        )}
        <span>Pipeline</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
          Digital Double Pipeline
        </p>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
            {data.package?.name ?? "Pipeline Job"}
          </h1>
          <span
            className="text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
            style={{ background: `${jobColor}18`, color: jobColor }}
          >
            {job.status}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-4 text-xs" style={{ color: "var(--color-muted)" }}>
          <span>Started {ts(job.createdAt)}</span>
          {job.completedAt && <span>Completed {ts(job.completedAt)}</span>}
          <span>SKUs: {(JSON.parse(job.skus) as string[]).join(", ")}</span>
        </div>
      </div>

      {/* Error */}
      {job.error && (
        <div className="mb-6 rounded border px-4 py-3 text-sm" style={{ borderColor: "#991b1b44", background: "#991b1b0a", color: "#991b1b" }}>
          {job.error}
        </div>
      )}

      {/* Stage track */}
      <div className="mb-8">
        <h2 className="text-[10px] uppercase tracking-widest font-semibold mb-4" style={{ color: "var(--color-muted)" }}>
          Pipeline stages
        </h2>
        <div>
          {orderedStages.map((stage) => (
            <StageRow key={stage.id} stage={stage} />
          ))}
        </div>
      </div>

      {/* Outputs */}
      {outputs.length > 0 && (
        <div>
          <h2 className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--color-muted)" }}>
            Downloads
          </h2>
          <div className="space-y-2">
            {outputs.map((out) => (
              <div
                key={out.id}
                className="flex items-center justify-between gap-4 rounded border px-4 py-3"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    {SKU_LABELS[out.sku] ?? out.sku}
                  </p>
                  <p className="text-xs mt-0.5 font-mono" style={{ color: "var(--color-muted)" }}>
                    {out.filename} · {fmt(out.sizeBytes)}
                  </p>
                </div>
                <a
                  href={`/api/pipeline/outputs/${out.id}/download`}
                  className="shrink-0 text-xs px-4 py-2 rounded font-medium text-white transition hover:opacity-90"
                  style={{ background: "var(--color-accent)" }}
                  download
                >
                  Download
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* In-progress note */}
      {["queued", "processing"].includes(job.status) && (
        <p className="mt-6 text-xs" style={{ color: "var(--color-muted)" }}>
          This page refreshes automatically every 5 seconds.
        </p>
      )}
    </div>
  );
}
