"use client";

import { useState } from "react";
import type { CloneRunRecord } from "@/app/api/admin/clone-packages/route";

interface Props {
  todayRecord: CloneRunRecord | null;
}

function ts(unix: number) {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function CloneClient({ todayRecord }: Props) {
  const [sourceEmail, setSourceEmail] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; summary: { packages: number; files: number; filesFailed: number; tags: number } }
    | { error: string }
    | null
  >(null);

  const alreadyRan = todayRecord !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed || alreadyRan || loading) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/admin/clone-packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceEmail: sourceEmail.trim(), targetEmail: targetEmail.trim() }),
      });
      const data = await res.json() as
        | { ok: true; summary: { packages: number; files: number; filesFailed: number; tags: number } }
        | { error: string };
      setResult(data);
    } catch {
      setResult({ error: "Network error. Check the console." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Already-ran banner */}
      {alreadyRan && (
        <div
          className="rounded border p-4 mb-6"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
            Already run today
          </p>
          <div className="space-y-1">
            <Row label="Triggered by" value={todayRecord.triggeredBy} />
            <Row label="Source" value={todayRecord.sourceEmail} />
            <Row label="Target" value={todayRecord.targetEmail} />
            <Row label="Ran at" value={ts(todayRecord.runAt)} />
            <Row label="Packages" value={String(todayRecord.summary.packages)} />
            <Row label="Files" value={String(todayRecord.summary.files)} />
            {todayRecord.summary.filesFailed > 0 && (
              <Row label="Files failed" value={String(todayRecord.summary.filesFailed)} accent />
            )}
          </div>
          <p className="text-xs mt-3" style={{ color: "var(--color-muted)" }}>
            This operation can only be run once per UTC day. It resets at midnight UTC.
          </p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <div
          className="rounded border p-5 mb-4 space-y-4"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-surface)",
            opacity: alreadyRan ? 0.5 : 1,
            pointerEvents: alreadyRan ? "none" : undefined,
          }}
        >
          <div>
            <label className="block text-xs font-medium uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>
              Source account (copy from)
            </label>
            <input
              type="email"
              value={sourceEmail}
              onChange={(e) => setSourceEmail(e.target.value)}
              placeholder="talent@example.com"
              required
              className="w-full rounded border px-3 py-2 text-sm outline-none"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-ink)",
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-widest mb-1.5" style={{ color: "var(--color-muted)" }}>
              Target account (copy to)
            </label>
            <input
              type="email"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              placeholder="alias@example.com"
              required
              className="w-full rounded border px-3 py-2 text-sm outline-none"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-ink)",
              }}
            />
          </div>
        </div>

        {/* Confirmation checkbox */}
        <label
          className="flex items-start gap-3 cursor-pointer mb-5 select-none"
          style={{ opacity: alreadyRan ? 0.4 : 1 }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={alreadyRan}
            className="mt-0.5 w-4 h-4 shrink-0"
            style={{ accentColor: "#c0392b" }}
          />
          <span className="text-sm" style={{ color: "var(--color-ink)" }}>
            I understand this is irreversible. R2 files will be physically copied and all admins will be notified.
          </span>
        </label>

        <button
          type="submit"
          disabled={!confirmed || alreadyRan || loading}
          className="px-5 py-2.5 rounded text-sm font-medium transition"
          style={{
            background: confirmed && !alreadyRan ? "#c0392b" : "var(--color-border)",
            color: confirmed && !alreadyRan ? "#ffffff" : "var(--color-muted)",
            cursor: confirmed && !alreadyRan && !loading ? "pointer" : "not-allowed",
          }}
        >
          {loading ? "Cloning…" : "Clone packages"}
        </button>
      </form>

      {/* Result */}
      {result && "ok" in result && (
        <div
          className="rounded border p-4 mt-5"
          style={{ borderColor: "#166534", background: "rgba(22,101,52,0.06)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#166534" }}>
            Done
          </p>
          <div className="space-y-1">
            <Row label="Packages" value={String(result.summary.packages)} />
            <Row label="Files copied" value={String(result.summary.files)} />
            <Row label="Tags copied" value={String(result.summary.tags)} />
            {result.summary.filesFailed > 0 && (
              <Row label="Files failed" value={String(result.summary.filesFailed)} accent />
            )}
          </div>
          <p className="text-xs mt-3" style={{ color: "var(--color-muted)" }}>
            All admins have been notified by email. Reload the page to see the rate-limit record.
          </p>
        </div>
      )}

      {result && "error" in result && (
        <div
          className="rounded border p-4 mt-5"
          style={{ borderColor: "#c0392b", background: "rgba(192,57,43,0.06)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#c0392b" }}>Error</p>
          <p className="text-sm" style={{ color: "var(--color-ink)" }}>{result.error}</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-28 shrink-0 text-xs uppercase tracking-widest font-medium" style={{ color: "var(--color-muted)" }}>
        {label}
      </span>
      <span style={{ color: accent ? "#c0392b" : "var(--color-ink)" }}>{value}</span>
    </div>
  );
}
