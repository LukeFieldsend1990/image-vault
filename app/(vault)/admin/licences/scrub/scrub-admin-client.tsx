"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ScrubRow } from "./page";

type Filter = "all" | "pending" | "overdue" | "closed";

const STATUS_COLOR: Record<string, string> = {
  SCRUB_PERIOD: "#d97706",
  OVERDUE: "#991b1b",
  CLOSED: "#374151",
};

function ts(unix: number) {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function DeadlinePill({ daysRemaining, status }: { daysRemaining: number | null; status: string }) {
  if (status === "CLOSED") return <span className="text-xs" style={{ color: "var(--color-muted)" }}>Closed</span>;
  if (daysRemaining == null) return <span className="text-xs" style={{ color: "var(--color-muted)" }}>—</span>;
  if (daysRemaining < 0) {
    return (
      <span className="text-xs font-semibold" style={{ color: "#991b1b" }}>
        {Math.abs(daysRemaining)}d overdue
      </span>
    );
  }
  return (
    <span className="text-xs" style={{ color: daysRemaining <= 3 ? "#d97706" : "var(--color-text)" }}>
      {daysRemaining}d left
    </span>
  );
}

function BridgePurgePill({ grants }: { grants: { total: number; purgeCompleted: number } }) {
  if (grants.total === 0) return <span className="text-xs" style={{ color: "var(--color-muted)" }}>No grants</span>;
  const allDone = grants.purgeCompleted === grants.total;
  return (
    <span
      className="text-xs font-medium"
      style={{ color: allDone ? "#166534" : "#d97706" }}
    >
      {grants.purgeCompleted}/{grants.total} purged
    </span>
  );
}

function ExtendForm({ licenceId, onDone }: { licenceId: string; onDone: () => void }) {
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    if (!reason.trim()) { setError("Reason is required."); return; }
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/licences/${licenceId}/scrub/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additionalDays: days, reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? "Failed to extend deadline.");
        return;
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <div
      className="mt-3 p-4 rounded border"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
    >
      <p className="text-xs font-semibold mb-3 uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
        Extend Deadline
      </p>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
            Additional days (1–30)
          </label>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Math.min(30, Math.max(1, Number(e.target.value))))}
            className="w-20 rounded border px-2 py-1 text-sm"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
            Reason (required)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Production delays on client side"
            className="w-full rounded border px-2 py-1 text-sm"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={pending}
            className="px-3 py-1.5 rounded text-xs font-semibold"
            style={{ background: "var(--color-accent)", color: "#fff", opacity: pending ? 0.6 : 1 }}
          >
            {pending ? "Saving…" : "Extend"}
          </button>
          <button
            onClick={onDone}
            className="px-3 py-1.5 rounded text-xs"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
          >
            Cancel
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs" style={{ color: "#991b1b" }}>{error}</p>}
    </div>
  );
}

function AttestationDetail({ att }: { att: NonNullable<ScrubRow["attestation"]> }) {
  return (
    <div
      className="mt-3 p-4 rounded border text-xs space-y-2"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
    >
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span style={{ color: "var(--color-muted)" }}>
          Submitted <strong style={{ color: "var(--color-ink)" }}>{ts(att.attestedAt)}</strong>
          {" "}by <strong style={{ color: "var(--color-ink)" }}>{att.attestedByEmail}</strong>
        </span>
        {att.ipAddress && (
          <span style={{ color: "var(--color-muted)" }}>
            IP <strong style={{ color: "var(--color-ink)" }}>{att.ipAddress}</strong>
          </span>
        )}
        <span style={{ color: att.bridgeCachePurged ? "#166534" : "#991b1b" }}>
          Bridge cache: <strong>{att.bridgeCachePurged ? "Purged ✓" : "Not confirmed"}</strong>
        </span>
      </div>
      {att.devicesScrubbed.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>Devices scrubbed</p>
          <ul className="list-disc list-inside space-y-0.5" style={{ color: "var(--color-ink)" }}>
            {att.devicesScrubbed.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}
      {att.additionalNotes && (
        <div>
          <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>Notes</p>
          <p style={{ color: "var(--color-ink)" }}>{att.additionalNotes}</p>
        </div>
      )}
    </div>
  );
}

function Row({ row }: { row: ScrubRow }) {
  const [expanded, setExpanded] = useState(false);
  const [extending, setExtending] = useState(false);
  const canExtend = row.status === "SCRUB_PERIOD" || row.status === "OVERDUE";

  return (
    <div
      className="border-b last:border-0"
      style={{ borderColor: "var(--color-border)" }}
    >
      {/* Main row */}
      <div
        className="grid items-start px-5 py-3.5 text-sm min-w-[860px] cursor-pointer hover:bg-[var(--color-surface)]"
        style={{ gridTemplateColumns: "2fr 1.4fr 1.4fr 90px 90px 90px 100px" }}
        onClick={() => { setExpanded((v) => !v); setExtending(false); }}
      >
        {/* Project */}
        <div className="min-w-0 pr-3">
          <p className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{row.projectName}</p>
          <p className="text-[11px] truncate" style={{ color: "var(--color-muted)" }}>{row.productionCompany}</p>
        </div>

        {/* Talent */}
        <span className="text-xs truncate" style={{ color: "var(--color-text)" }}>{row.talentEmail}</span>

        {/* Licensee */}
        <span className="text-xs truncate" style={{ color: "var(--color-text)" }}>{row.licenseeEmail}</span>

        {/* Status */}
        <div>
          <span
            className="inline-flex items-center text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
            style={{
              background: `${STATUS_COLOR[row.status] ?? "#374151"}18`,
              color: STATUS_COLOR[row.status] ?? "#374151",
            }}
          >
            {row.status === "SCRUB_PERIOD" ? "Scrub" : row.status.charAt(0) + row.status.slice(1).toLowerCase()}
          </span>
        </div>

        {/* Deadline */}
        <DeadlinePill daysRemaining={row.daysRemaining} status={row.status} />

        {/* Attestation */}
        <div>
          {row.attestation
            ? <span className="text-xs" style={{ color: "#166534" }}>Submitted ✓</span>
            : <span className="text-xs" style={{ color: "var(--color-muted)" }}>Pending</span>
          }
        </div>

        {/* Bridge purge */}
        <BridgePurgePill grants={row.bridgeGrants} />
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-5 pb-4 min-w-[860px]">
          {row.attestation
            ? <AttestationDetail att={row.attestation} />
            : (
              <p className="text-xs mt-2" style={{ color: "var(--color-muted)" }}>
                No attestation submitted yet.
              </p>
            )
          }

          {canExtend && !extending && (
            <button
              onClick={(e) => { e.stopPropagation(); setExtending(true); }}
              className="mt-3 text-xs px-3 py-1.5 rounded border"
              style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
            >
              Extend deadline
            </button>
          )}

          {extending && (
            <ExtendForm licenceId={row.id} onDone={() => setExtending(false)} />
          )}
        </div>
      )}
    </div>
  );
}

export default function ScrubAdminClient({ rows }: { rows: ScrubRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = rows.filter((r) => {
    if (filter === "pending") return r.status === "SCRUB_PERIOD";
    if (filter === "overdue") return r.status === "OVERDUE";
    if (filter === "closed") return r.status === "CLOSED";
    return true;
  });

  const counts = {
    all: rows.length,
    pending: rows.filter((r) => r.status === "SCRUB_PERIOD").length,
    overdue: rows.filter((r) => r.status === "OVERDUE").length,
    closed: rows.filter((r) => r.status === "CLOSED").length,
  };

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: `All (${counts.all})` },
    { key: "pending", label: `Scrub period (${counts.pending})` },
    { key: "overdue", label: `Overdue (${counts.overdue})` },
    { key: "closed", label: `Closed (${counts.closed})` },
  ];

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className="px-3 py-1.5 rounded text-xs font-medium transition"
            style={{
              background: filter === t.key ? "var(--color-ink)" : "var(--color-surface)",
              color: filter === t.key ? "var(--color-bg)" : "var(--color-muted)",
              border: "1px solid var(--color-border)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm py-6" style={{ color: "var(--color-muted)" }}>No licences match this filter.</p>
      )}

      {filtered.length > 0 && (
        <div>
          <p className="text-[10px] text-right mb-1 sm:hidden" style={{ color: "var(--color-muted)" }}>Scroll for more →</p>
          <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
            {/* Header */}
            <div
              className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[860px]"
              style={{
                gridTemplateColumns: "2fr 1.4fr 1.4fr 90px 90px 90px 100px",
                color: "var(--color-muted)",
                background: "var(--color-surface)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span>Project</span>
              <span>Talent</span>
              <span>Licensee</span>
              <span>Status</span>
              <span>Deadline</span>
              <span>Attestation</span>
              <span>Bridge purge</span>
            </div>

            {filtered.map((r) => <Row key={r.id} row={r} />)}
          </div>
        </div>
      )}
    </div>
  );
}
