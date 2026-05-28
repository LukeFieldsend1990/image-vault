"use client";

import { useState, useEffect } from "react";

type EventCategory = "download" | "licence" | "auth" | "bridge" | "vault" | "invite" | "admin";

export type AuditEvent = {
  id: string;
  category: EventCategory;
  timestamp: number;
  actor: string | null;
  detail: string;
  meta: string | null;
  severity: "info" | "warn" | "critical";
};

const PAGE_SIZE = 50;

const CATEGORY_CONFIG: Record<EventCategory, { label: string; color: string }> = {
  download: { label: "Download", color: "#166534" },
  licence:  { label: "Licence",  color: "#1d4ed8" },
  auth:     { label: "Auth",     color: "#7c3aed" },
  bridge:   { label: "Bridge",   color: "#0891b2" },
  vault:    { label: "Vault",    color: "#b45309" },
  invite:   { label: "Invite",   color: "#6d28d9" },
  admin:    { label: "Admin",    color: "#dc2626" },
};

const SEVERITY_DOT: Record<string, string> = {
  info: "transparent",
  warn: "#d97706",
  critical: "#dc2626",
};

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AuditEventTable() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [shown, setShown]     = useState(PAGE_SIZE);

  useEffect(() => {
    fetch("/api/admin/audit/events")
      .then(r => r.json())
      .then((data) => {
        const { events } = data as { events: AuditEvent[] };
        setEvents(events);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  const visible   = events.slice(0, shown);
  const remaining = events.length - shown;

  const counts = new Map<EventCategory, number>();
  for (const e of events) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);

  return (
    <div>
      {/* Category pills — shown once data loads */}
      {!loading && events.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {(Object.entries(CATEGORY_CONFIG) as [EventCategory, { label: string; color: string }][])
            .filter(([cat]) => (counts.get(cat) ?? 0) > 0)
            .map(([cat, cfg]) => (
              <span
                key={cat}
                className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: `${cfg.color}12`, color: cfg.color }}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: cfg.color }} />
                {counts.get(cat)} {cfg.label}
              </span>
            ))}
        </div>
      )}

      <p className="text-[10px] text-right sm:hidden mb-1" style={{ color: "var(--color-muted)" }}>
        Scroll for more &rarr;
      </p>
      <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[800px]"
          style={{
            gridTemplateColumns: "90px 1.4fr 2.4fr 1fr 1fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Category</span>
          <span>Actor</span>
          <span>Event</span>
          <span>Details</span>
          <span>Date &amp; time</span>
        </div>

        {loading && (
          <div className="px-5 py-8 flex items-center gap-3" style={{ color: "var(--color-muted)" }}>
            <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
            <span className="text-sm">Loading events…</span>
          </div>
        )}

        {!loading && error && (
          <p className="px-5 py-6 text-sm" style={{ color: "#dc2626" }}>
            Failed to load events.
          </p>
        )}

        {!loading && !error && events.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>
            No events yet.
          </p>
        )}

        {visible.map((e) => {
          const cfg = CATEGORY_CONFIG[e.category];
          return (
            <div
              key={e.id}
              className="grid items-center px-5 py-3 border-b last:border-0 text-xs min-w-[800px]"
              style={{ gridTemplateColumns: "90px 1.4fr 2.4fr 1fr 1fr", borderColor: "var(--color-border)" }}
            >
              <span className="flex items-center gap-1.5">
                {e.severity !== "info" && (
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full flex-shrink-0"
                    style={{ background: SEVERITY_DOT[e.severity] }}
                  />
                )}
                <span
                  className="inline-flex items-center text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
                  style={{ background: `${cfg.color}14`, color: cfg.color }}
                >
                  {cfg.label}
                </span>
              </span>

              <span className="truncate" style={{ color: "var(--color-text)" }}>{e.actor ?? "—"}</span>
              <span className="truncate" style={{ color: "var(--color-text)" }}>{e.detail}</span>
              <span className="truncate font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>{e.meta ?? ""}</span>
              <span style={{ color: "var(--color-muted)" }}>{ts(e.timestamp)}</span>
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
