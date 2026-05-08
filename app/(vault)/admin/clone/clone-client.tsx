"use client";

import { useState } from "react";
import type { CloneRunRecord, ClonePackageItem, FileToCopy } from "@/app/api/admin/clone-packages/route";

interface Props {
  todayRecord: CloneRunRecord | null;
}

interface PackageStat {
  id: string;
  name: string;
  status: "pending" | "preparing" | "copying" | "done" | "skipped" | "error";
  errorMsg?: string;
  totalFiles?: number;
  copiedFiles?: number;
  failedFiles?: number;
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
  const [runRecord, setRunRecord] = useState<CloneRunRecord | null>(todayRecord);

  const alreadyRan = runRecord !== null;
  const canStart = confirmed && !alreadyRan && phase === "idle";

  async function clearBlock() {
    await fetch("/api/admin/clone-packages", { method: "DELETE" });
    setRunRecord(null);
  }

  function updatePkg(id: string, patch: Partial<PackageStat>) {
    setPackages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

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

    setPackages(pkgList.map((p) => ({ id: p.id, name: p.name, status: "pending" })));
    setPhase("cloning");

    const acc = { packages: 0, files: 0, tags: 0, filesFailed: 0, skipped: 0, errors: 0 };

    // Step 2: for each package — prepare (DB records) then copy files one-by-one
    for (const pkg of pkgList) {
      updatePkg(pkg.id, { status: "preparing" });

      let filesToCopy: FileToCopy[];
      let pkgTags = 0;

      // Prepare: creates DB records, returns file copy tasks
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
          newPackageId?: string;
          filesToCopy?: FileToCopy[];
          tags?: number;
        };

        if (d.skipped) {
          acc.skipped++;
          updatePkg(pkg.id, { status: "skipped" });
          setTotals({ ...acc });
          continue;
        }

        filesToCopy = d.filesToCopy ?? [];
        pkgTags = d.tags ?? 0;
        acc.tags += pkgTags;
      } catch (err) {
        acc.errors++;
        updatePkg(pkg.id, { status: "error", errorMsg: err instanceof Error ? err.message : "Prepare failed" });
        setTotals({ ...acc });
        continue;
      }

      // Copy files one at a time
      updatePkg(pkg.id, { status: "copying", totalFiles: filesToCopy.length, copiedFiles: 0, failedFiles: 0 });
      let copied = 0;
      let failed = 0;

      for (const f of filesToCopy) {
        try {
          const res = await fetch("/api/admin/clone-packages/copy-file", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileId: f.fileId, sourceKey: f.sourceKey, destKey: f.destKey }),
          });

          if (!res.ok) {
            const d = await res.json() as { error?: string };
            throw new Error(d.error ?? `HTTP ${res.status}`);
          }

          copied++;
          acc.files++;
        } catch {
          failed++;
          acc.filesFailed++;
        }

        updatePkg(pkg.id, { copiedFiles: copied, failedFiles: failed });
        setTotals({ ...acc });
      }

      acc.packages++;
      updatePkg(pkg.id, {
        status: failed > 0 && copied === 0 ? "error" : "done",
        copiedFiles: copied,
        failedFiles: failed,
      });
      setTotals({ ...acc });
    }

    // Step 3: finalize
    try {
      await fetch("/api/admin/clone-packages/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceEmail: sourceEmail.trim(),
          targetEmail: targetEmail.trim(),
          ...acc,
          hasErrors: acc.errors > 0 || acc.filesFailed > 0,
        }),
      });
    } catch {
      // Non-fatal
    }

    setPhase("done");
  }

  return (
    <div>
      {/* Already-ran banner */}
      {runRecord && (
        <div
          className="rounded border p-4 mb-6"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
            Already run today
          </p>
          <div className="space-y-1">
            <Row label="Triggered by" value={runRecord.triggeredBy} />
            <Row label="Source" value={runRecord.sourceEmail} />
            <Row label="Target" value={runRecord.targetEmail} />
            <Row label="Ran at" value={ts(runRecord.runAt)} />
            <Row label="Packages" value={String(runRecord.summary.packages)} />
            <Row label="Files" value={String(runRecord.summary.files)} />
            {runRecord.summary.skipped > 0 && (
              <Row label="Skipped" value={String(runRecord.summary.skipped)} />
            )}
            {runRecord.summary.filesFailed > 0 && (
              <Row label="Files failed" value={String(runRecord.summary.filesFailed)} accent />
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>Resets at midnight UTC.</p>
            <button
              onClick={clearBlock}
              className="text-xs underline"
              style={{ color: "#c0392b", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              Clear block and retry
            </button>
          </div>
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
        <div className="rounded border mt-6" style={{ borderColor: "var(--color-border)" }}>
          <div
            className="px-4 py-3 border-b flex items-center justify-between"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              Progress
            </p>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              {packages.filter((p) => ["done", "skipped", "error"].includes(p.status)).length} / {packages.length}
            </p>
          </div>
          <div>
            {packages.map((pkg) => (
              <div
                key={pkg.id}
                className="px-4 py-3 border-b last:border-0"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>{pkg.name}</p>
                  <StatusBadge pkg={pkg} />
                </div>
                {pkg.status === "copying" && pkg.totalFiles !== undefined && (
                  <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
                    {pkg.copiedFiles ?? 0} / {pkg.totalFiles} files copied
                    {(pkg.failedFiles ?? 0) > 0 && ` · ${pkg.failedFiles} failed`}
                  </p>
                )}
                {pkg.errorMsg && (
                  <p className="text-xs mt-1" style={{ color: "#c0392b" }}>{pkg.errorMsg}</p>
                )}
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

function StatusBadge({ pkg }: { pkg: PackageStat }) {
  if (pkg.status === "copying" && pkg.totalFiles !== undefined) {
    return (
      <span
        className="shrink-0 text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded"
        style={{ color: "#d97706", background: "rgba(217,119,6,0.1)" }}
      >
        {pkg.copiedFiles ?? 0}/{pkg.totalFiles} files
      </span>
    );
  }

  const map: Record<PackageStat["status"], { label: string; color: string; bg: string }> = {
    pending:   { label: "Pending",    color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
    preparing: { label: "Preparing…", color: "#d97706", bg: "rgba(217,119,6,0.1)" },
    copying:   { label: "Copying…",   color: "#d97706", bg: "rgba(217,119,6,0.1)" },
    done:      { label: "Done",       color: "#166534", bg: "rgba(22,101,52,0.1)" },
    skipped:   { label: "Skipped",    color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
    error:     { label: "Error",      color: "#c0392b", bg: "rgba(192,57,43,0.1)" },
  };
  const s = map[pkg.status];
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
