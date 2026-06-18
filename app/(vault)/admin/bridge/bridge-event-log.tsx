"use client";

import { useState, useEffect } from "react";

interface BridgeEvent {
  id: string;
  grantId: string | null;
  packageId: string | null;
  deviceId: string;
  userId: string | null;
  eventType: string;
  severity: string;
  detail: string | null;
  createdAt: number;
}

interface Props {
  agentNames: Record<string, string>;
}

const SEVERITY_COLOR: Record<string, { bg: string; text: string }> = {
  info:     { bg: "rgba(37,99,235,0.1)",  text: "#2563eb" },
  warn:     { bg: "rgba(217,119,6,0.1)",  text: "#d97706" },
  critical: { bg: "rgba(153,27,27,0.12)", text: "#991b1b" },
};

const EVENT_LABELS: Record<string, string> = {
  tamper_detected:         "Tamper detected",
  unexpected_copy:         "Unexpected copy",
  hash_mismatch:           "Hash mismatch",
  lease_expired:           "Lease expired",
  cache_purged:            "Cache purged",
  open_denied:             "Open denied",
  purge_started:           "Purge started",
  purge_partial:           "Purge partial",
  purge_stalled:           "Purge stalled",
  purge_failed:            "Purge failed",
  file_in_use:             "File in use",
  file_removed_from_cache: "File removed",
  re_access_denied:        "Re-access denied",
  agent_enrolled:          "Agent enrolled",
  agent_online:            "Agent online",
  agent_purge_complete:    "Self-purge complete",
  agent_publish_complete:  "Package published",
  agent_revoked:           "Agent revoked",
};

const LIFECYCLE_EVENT_TYPES = new Set([
  "agent_enrolled", "agent_online", "agent_purge_complete",
  "agent_publish_complete", "agent_revoked",
]);

function tsTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatDetail(detail: string | null): { pretty: string; flat: string } {
  if (!detail) return { pretty: "—", flat: "—" };
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    return {
      pretty: JSON.stringify(parsed, null, 2),
      flat: Object.entries(parsed).map(([k, v]) => `${k}: ${String(v)}`).join(", "),
    };
  } catch {
    return { pretty: detail, flat: detail };
  }
}

const GRID = "1fr 1.5fr 1.2fr 1.4fr 1fr 1fr 2fr";
const PAGE_SIZE = 25;

export function BridgeEventLog({ agentNames }: Props) {
  const [events, setEvents]         = useState<BridgeEvent[]>([]);
  const [pkgNames, setPkgNames]     = useState<Record<string, string>>({});
  const [userEmails, setUserEmails] = useState<Record<string, string>>({});
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [shown, setShown]           = useState(PAGE_SIZE);

  useEffect(() => {
    fetch("/api/admin/bridge/events")
      .then(r => r.json())
      .then((data) => {
        const { events, pkgNames, userEmails } = data as { events: BridgeEvent[]; pkgNames: Record<string, string>; userEmails: Record<string, string> };
        setEvents(events);
        setPkgNames(pkgNames);
        setUserEmails(userEmails);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  const visibleEvents = events.slice(0, shown);
  const remaining     = events.length - shown;

  function downloadCsv() {
    const header = ["When", "Package", "Source", "User", "Type", "Severity", "Detail"];
    const rows = events.map(e => {
      const agentName = agentNames[e.deviceId];
      const source = agentName
        ? agentName
        : e.grantId
          ? `CAS·${e.grantId.slice(0, 6)}`
          : e.deviceId.slice(0, 8);
      return [
        tsTime(e.createdAt),
        e.packageId ? (pkgNames[e.packageId] ?? e.packageId) : "—",
        source,
        e.userId ? (userEmails[e.userId] ?? e.userId) : "—",
        e.eventType,
        e.severity,
        formatDetail(e.detail).flat,
      ];
    });
    const csv = [header, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bridge-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Event Log
        </h2>
        {!loading && events.length > 0 && (
          <button
            onClick={downloadCsv}
            className="text-[11px] font-medium px-3 py-1.5 rounded border"
            style={{ color: "var(--color-ink)", borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            Download CSV
          </button>
        )}
      </div>

      <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[1080px]"
          style={{
            gridTemplateColumns: GRID,
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>When</span>
          <span>Package</span>
          <span>Source</span>
          <span>User</span>
          <span>Type</span>
          <span>Severity</span>
          <span>Detail</span>
        </div>

        {loading && (
          <div className="px-5 py-8 flex items-center gap-3" style={{ color: "var(--color-muted)" }}>
            <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
            <span className="text-sm">Loading events…</span>
          </div>
        )}

        {!loading && error && (
          <p className="px-5 py-5 text-sm" style={{ color: "#dc2626" }}>
            Failed to load events.
          </p>
        )}

        {!loading && !error && events.length === 0 && (
          <p className="px-5 py-5 text-sm" style={{ color: "var(--color-muted)" }}>
            No bridge events recorded yet.
          </p>
        )}

        {visibleEvents.map(e => {
          const sev = SEVERITY_COLOR[e.severity] ?? SEVERITY_COLOR.warn;
          const { pretty, flat } = formatDetail(e.detail);
          const agentName = agentNames[e.deviceId];
          const isRenderBridge = agentName !== undefined;
          const isLifecycle = LIFECYCLE_EVENT_TYPES.has(e.eventType);
          const isExpanded = expandedId === e.id;

          return (
            <div key={e.id} style={{ borderBottom: "1px solid var(--color-border)" }} className="last:border-0">
              <div
                className="grid items-start px-5 py-3 text-xs min-w-[1080px] cursor-pointer"
                style={{ gridTemplateColumns: GRID }}
                onClick={() => setExpandedId(isExpanded ? null : e.id)}
              >
                <span style={{ color: "var(--color-muted)" }}>{tsTime(e.createdAt)}</span>

                <span className="truncate font-medium" style={{ color: isLifecycle ? "var(--color-muted)" : "var(--color-ink)" }}>
                  {e.packageId
                    ? (pkgNames[e.packageId] ?? e.packageId.slice(0, 8) + "…")
                    : "—"}
                </span>

                <span>
                  {isRenderBridge ? (
                    <span
                      className="inline-flex text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "#16a34a18", color: "#16a34a" }}
                    >
                      {agentName}
                    </span>
                  ) : e.grantId ? (
                    <span
                      className="inline-flex text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(37,99,235,0.1)", color: "#2563eb" }}
                    >
                      CAS · {e.grantId.slice(0, 6)}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px]" style={{ color: "var(--color-muted)" }}>
                      {e.deviceId.slice(0, 8)}…
                    </span>
                  )}
                </span>

                <span className="truncate text-[10px]" style={{ color: "var(--color-muted)" }}>
                  {e.userId ? (userEmails[e.userId] ?? e.userId.slice(0, 8) + "…") : "—"}
                </span>

                <span style={{ color: "var(--color-muted)" }}>
                  {EVENT_LABELS[e.eventType] ?? e.eventType}
                </span>

                <span
                  className="inline-flex text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded w-fit"
                  style={{ background: sev.bg, color: sev.text }}
                >
                  {e.severity}
                </span>

                <span className="truncate font-mono text-[10px]" style={{ color: "var(--color-muted)" }}>
                  {flat}
                </span>
              </div>

              {isExpanded && (
                <div
                  className="px-5 pb-4 min-w-[1080px]"
                  style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-surface)" }}
                >
                  <p className="text-[10px] uppercase tracking-widest font-semibold mt-3 mb-2" style={{ color: "var(--color-muted)" }}>
                    Full Detail
                  </p>
                  <pre
                    className="text-[11px] font-mono whitespace-pre-wrap break-all rounded p-3"
                    style={{ color: "var(--color-ink)", background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
                  >
                    {pretty}
                  </pre>
                  <div className="mt-3 flex gap-6 text-[11px]" style={{ color: "var(--color-muted)" }}>
                    <span><span className="font-medium" style={{ color: "var(--color-ink)" }}>Event ID</span> {e.id}</span>
                    <span><span className="font-medium" style={{ color: "var(--color-ink)" }}>Device</span> {e.deviceId}</span>
                    {e.grantId && <span><span className="font-medium" style={{ color: "var(--color-ink)" }}>Grant</span> {e.grantId}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {remaining > 0 && (
        <div className="mt-3 flex justify-center">
          <button
            onClick={() => setShown(s => s + PAGE_SIZE)}
            className="text-[11px] font-medium px-4 py-2 rounded border"
            style={{ color: "var(--color-ink)", borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            Load {Math.min(remaining, PAGE_SIZE)} more
            <span className="ml-1.5" style={{ color: "var(--color-muted)" }}>({remaining} remaining)</span>
          </button>
        </div>
      )}
    </div>
  );
}
