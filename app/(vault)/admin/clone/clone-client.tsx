"use client";

import { useState } from "react";
import type { CloneRunRecord, ClonePackageItem } from "@/app/api/admin/clone-packages/route";

interface Props {
  todayRecord: CloneRunRecord | null;
}

interface PackageStat {
  id: string;
  name: string;
  status: "pending" | "cloning" | "done" | "skipped" | "error";
  files?: number;
  filesFailed?: number;
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
  const [phase, setPhase] = useState<"idle" | "loading" | "cloning" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [packages, setPackages] = useState<PackageStat[]>([]);
  const [totals, setTotals] = useState({ packages: 0, files: 0, tags: 0, filesFailed: 0, skipped: 0 });

  const alreadyRan = todayRecord !== null;
  const canStart = confirmed && !alreadyRan && phase === "idle";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canStart) return;

    setPhase("loading");
    setErrorMsg(null);

    // Step 1: fetch package list
    let pkgList: ClonePackageItem[];
    try {
      const res = await fetch(
        `/api/admin/clone-packages?sourceEmail=${encodeURIComponent(sourceEmail.trim())}`,
      );
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { record: CloneRunRecord | null; packages: ClonePackageItem[] };
      if (data.record) {
        setPhase("error");
        setErrorMsg("Already ran today — reload the page.");
        return;
      }
      pkgList = data.packages ?? [];
    } catch (err) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to fetch package list");
      return;
    }

    if (pkgList.length === 0) {
      setPhase("error");
      setErrorMsg("No packages found on source account.");
      return;
    }

    // Initialise per-package status rows
    setPackages(pkgList.map((p) => ({ id: p.id, name: p.name, status: "pending" })));
    setPhase("cloning");

    const acc = { packages: 0, files: 0, tags: 0, filesFailed: 0, skipped: 0 };

    // Step 2: clone each package sequentially
    for (let i = 0; i < pkgList.length; i++) {
      const pkg = pkgList[i];

      setPackages((prev) =>
        prev.map((p) => (p.id === pkg.id ? { ...p, status: "cloning" } : p)),
      );

      try {
        const res = await fetch("/api/admin/clone-packages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceEmail: sourceEmail.trim(),
            targetEmail: targetEmail.trim(),
            packageId: pkg.id,
          }),
        });

        if (!res.ok) {
          const d = await res.json() as { error?: string };
          throw new Error(d.error ?? `HTTP ${res.status}`);
        }

        const d = await res.json() as {
          skipped: boolean;
          reason?: string;
          files?: number;
          filesFailed?: number;
          tags?: number;
        };

        if (d.skipped) {
          acc.skipped++;
          setPackages((prev) =>
            prev.map((p) => (p.id === pkg.id ? { ...p, status: "skipped" } : p)),
          );
        } else {
          acc.packages++;
          acc.files += d.files ?? 0;
          acc.filesFailed += d.filesFailed ?? 0;
          acc.tags += d.tags ?? 0;
          setPackages((prev) =>
            prev.map((p) =>
              p.id === pkg.id
                ? { ...p, status: "done", files: d.files, filesFailed: d.filesFailed }
                : p,
            ),
          );
        }
      } catch (err) {
        setPackages((prev) =>
          prev.map((p) => (p.id === pkg.id ? { ...p, status: "error" } : p)),
        );
        // Non-fatal — continue with remaining packages
      }

      setTotals({ ...acc });
    }

    // Step 3: finalize — write KV record and send admin email
    try {
      await fetch("/api/admin/clone-packages/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceEmail: sourceEmail.trim(),
          targetEmail: targetEmail.trim(),
          ...acc,
        }),
      });
    } catch {
      // Non-fatal: record may not be written but clone data is safe
    }

    setPhase("done");
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
            {todayRecord.summary.skipped > 0 && (
              <Row label="Skipped" value={String(todayRecord.summary.skipped)} />
            )}
            {todayRecord.summary.filesFailed > 0 && (
              <Row label="Files failed" value={String(todayRecord.summary.filesFailed)} accent />
            )}
          </div>
          <p className="text-xs mt-3" style={{ color: "var(--color-muted)" }}>
            Resets at midnight UTC.
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
            opacity: alreadyRan || phase !== "idle" ? 0.5 : 1,
            pointerEvents: alreadyRan || phase !== "idle" ? "none" : undefined,
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
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
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
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
            />
          </div>
        </div>

        <label
          className="flex items-start gap-3 cursor-pointer mb-5 select-none"
          style={{ opacity: alreadyRan || phase !== "idle" ? 0.4 : 1 }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={alreadyRan || phase !== "idle"}
            className="mt-0.5 w-4 h-4 shrink-0"
            style={{ accentColor: "#c0392b" }}
          />
          <span className="text-sm" style={{ color: "var(--color-ink)" }}>
            I understand this is irreversible. R2 files will be physically copied and all admins will be notified.
          </span>
        </label>

        <button
          type="submit"
          disabled={!canStart}
          className="px-5 py-2.5 rounded text-sm font-medium transition"
          style={{
            background: canStart ? "#c0392b" : "var(--color-border)",
            color: canStart ? "#ffffff" : "var(--color-muted)",
            cursor: canStart ? "pointer" : "not-allowed",
          }}
        >
          {phase === "loading" ? "Preparing…" : "Clone packages"}
        </button>
      </form>

      {/* Per-package progress */}
      {packages.length > 0 && (
        <div
          className="rounded border mt-6"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              Progress
            </p>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              {packages.filter((p) => p.status === "done" || p.status === "skipped" || p.status === "error").length} / {packages.length}
            </p>
          </div>
          <div>
            {packages.map((pkg) => (
              <div
                key={pkg.id}
                className="px-4 py-2.5 border-b last:border-0 flex items-center justify-between gap-3"
                style={{ borderColor: "var(--color-border)" }}
              >
                <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>{pkg.name}</p>
                <StatusBadge status={pkg.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Final summary */}
      {phase === "done" && (
        <div
          className="rounded border p-4 mt-5"
          style={{ borderColor: "#166534", background: "rgba(22,101,52,0.06)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#166534" }}>
            Complete
          </p>
          <div className="space-y-1">
            <Row label="Packages" value={String(totals.packages)} />
            <Row label="Files copied" value={String(totals.files)} />
            <Row label="Tags copied" value={String(totals.tags)} />
            {totals.skipped > 0 && <Row label="Skipped (dedup)" value={String(totals.skipped)} />}
            {totals.filesFailed > 0 && <Row label="Files failed" value={String(totals.filesFailed)} accent />}
          </div>
          <p className="text-xs mt-3" style={{ color: "var(--color-muted)" }}>
            All admins notified by email. Reload to see the daily rate-limit record.
          </p>
        </div>
      )}

      {/* Error */}
      {phase === "error" && errorMsg && (
        <div
          className="rounded border p-4 mt-5"
          style={{ borderColor: "#c0392b", background: "rgba(192,57,43,0.06)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#c0392b" }}>Error</p>
          <p className="text-sm" style={{ color: "var(--color-ink)" }}>{errorMsg}</p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PackageStat["status"] }) {
  const map: Record<PackageStat["status"], { label: string; color: string; bg: string }> = {
    pending:  { label: "Pending",  color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
    cloning:  { label: "Cloning…", color: "#d97706", bg: "rgba(217,119,6,0.1)" },
    done:     { label: "Done",     color: "#166534", bg: "rgba(22,101,52,0.1)" },
    skipped:  { label: "Skipped",  color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
    error:    { label: "Error",    color: "#c0392b", bg: "rgba(192,57,43,0.1)" },
  };
  const s = map[status];
  return (
    <span
      className="shrink-0 text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded"
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
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
