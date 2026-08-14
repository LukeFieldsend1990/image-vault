"use client";

import { useCallback, useEffect, useState } from "react";

interface CronState {
  enabled: boolean;
  watchlistReharvestHours: number;
  lastRunAt: number | null;
}

function whenRelative(unix: number | null): string {
  if (!unix) return "never";
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function CronClient() {
  const [state, setState] = useState<CronState | null>(null);
  const [hoursInput, setHoursInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/monitor/cron");
    if (!res.ok) return;
    const data = (await res.json()) as CronState;
    setState(data);
    setHoursInput(String(data.watchlistReharvestHours));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (body: Record<string, unknown>, note: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/monitor/cron", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setMessage(err.error ?? "Update failed");
          return;
        }
        setMessage(note);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const runNow = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/monitor/cron", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { status?: number; body?: unknown };
      if (!res.ok) {
        setMessage(`Run failed (HTTP ${data.status ?? res.status})`);
        return;
      }
      const b = data.body as { dueCount?: number; ran?: number; skipped?: string };
      if (b?.skipped) {
        setMessage(`Skipped: ${b.skipped}`);
      } else if (typeof b?.ran === "number") {
        setMessage(`Kicked off ${b.ran} sweep${b.ran === 1 ? "" : "s"} (${b.dueCount} due). Runs in the background.`);
      } else {
        setMessage("Triggered.");
      }
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  if (!state) {
    return (
      <section className="text-xs" style={{ color: "var(--color-muted)" }}>
        Loading cron state…
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Cron controls
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Continuous sweeps run twice daily via ai-cron-worker, honouring each monitor&apos;s
          cadence. Global toggle here overrides — flipping to Off pauses the fleet without
          redeploying.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div
          className="rounded p-3"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="text-xs" style={{ color: "var(--color-muted)" }}>
            Cron status
          </div>
          <div
            className="mt-1 text-2xl font-semibold"
            style={{ color: state.enabled ? "var(--color-accent)" : "var(--color-muted)" }}
          >
            {state.enabled ? "On" : "Off"}
          </div>
        </div>
        <div
          className="rounded p-3"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="text-xs" style={{ color: "var(--color-muted)" }}>
            Last cron run
          </div>
          <div className="mt-1 text-2xl font-semibold" style={{ color: "var(--color-ink)" }}>
            {whenRelative(state.lastRunAt)}
          </div>
        </div>
        <div
          className="rounded p-3"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="text-xs" style={{ color: "var(--color-muted)" }}>
            Watchlist re-harvest
          </div>
          <div className="mt-1 text-2xl font-semibold" style={{ color: "var(--color-ink)" }}>
            {state.watchlistReharvestHours}h
          </div>
        </div>
      </div>

      {message && (
        <div
          className="text-xs px-3 py-2 rounded"
          style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
        >
          {message}
        </div>
      )}

      <div
        className="rounded p-4 space-y-3"
        style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
              Cron enabled
            </p>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              When off, ai-cron-worker still pings the endpoint but the endpoint short-circuits.
            </p>
          </div>
          <button
            onClick={() => void patch({ enabled: !state.enabled }, state.enabled ? "Cron paused" : "Cron enabled")}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded"
            style={{
              background: state.enabled ? "var(--color-surface)" : "var(--color-accent)",
              color: state.enabled ? "var(--color-ink)" : "white",
              border: state.enabled ? "1px solid var(--color-border)" : "none",
            }}
          >
            {state.enabled ? "Pause cron" : "Enable cron"}
          </button>
        </div>

        <hr style={{ borderColor: "var(--color-border)" }} />

        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
              Watchlist re-harvest interval (hours)
            </p>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              How often known offenders get re-swept. Hype cycles for a talent can run weeks, so
              raising this makes sense once the initial watchlist has stabilised.
            </p>
          </div>
          <div className="flex gap-1">
            <input
              type="number"
              min={1}
              max={24 * 90}
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
              className="w-20 text-xs px-2 py-1.5 rounded text-right"
              style={{
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-ink)",
              }}
            />
            <button
              onClick={() =>
                void patch(
                  { watchlistReharvestHours: parseInt(hoursInput || "0", 10) },
                  `Re-harvest interval set to ${hoursInput}h`
                )
              }
              disabled={busy || parseInt(hoursInput || "0", 10) < 1}
              className="text-xs px-3 py-1.5 rounded"
              style={{ background: "var(--color-ink)", color: "white" }}
            >
              Save
            </button>
          </div>
        </div>

        <hr style={{ borderColor: "var(--color-border)" }} />

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
              Run cron now
            </p>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              Fires the sweep endpoint immediately. Same code path as the twice-daily trigger.
            </p>
          </div>
          <button
            onClick={() => void runNow()}
            disabled={busy || !state.enabled}
            className="text-xs px-3 py-1.5 rounded"
            style={{
              background: state.enabled ? "var(--color-accent)" : "var(--color-surface)",
              color: state.enabled ? "white" : "var(--color-muted)",
              border: state.enabled ? "none" : "1px solid var(--color-border)",
              opacity: busy ? 0.6 : 1,
            }}
          >
            Run now
          </button>
        </div>
      </div>
    </section>
  );
}
