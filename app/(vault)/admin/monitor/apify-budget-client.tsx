"use client";

import { useCallback, useEffect, useState } from "react";

interface Budget {
  enabled: boolean;
  spent: number;
  ceiling: number;
  remaining: number;
  exhausted: boolean;
  since: number;
  runs: number;
}

interface UsageRun {
  id: string;
  runId: string | null;
  actorId: string;
  mode: string | null;
  query: string | null;
  itemCount: number;
  costUsd: number;
  costEstimated: boolean;
  status: string;
  error: string | null;
  createdAt: number;
}

interface Payload {
  budget: Budget;
  runs: UsageRun[];
  byTalent: Array<{ talentId: string | null; cost: number; runs: number }>;
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

function when(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ApifyBudgetClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [ceilingInput, setCeilingInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/monitor/apify");
    if (!res.ok) return;
    const payload = (await res.json()) as Payload;
    setData(payload);
    setCeilingInput(payload.budget.ceiling.toFixed(2));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (body: Record<string, unknown>, note: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/monitor/apify", {
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

  const reset = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/monitor/apify", { method: "POST" });
      if (res.ok) {
        setMessage("Spend counter reset. Previous runs stay in the ledger.");
        await load();
      }
    } finally {
      setBusy(false);
    }
  }, [load]);

  if (!data) {
    return (
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        Loading…
      </p>
    );
  }

  const { budget } = data;
  const pct = budget.ceiling > 0 ? Math.min(100, (budget.spent / budget.ceiling) * 100) : 0;
  const barColor = budget.exhausted ? "#dc2626" : pct > 75 ? "#d97706" : "var(--color-accent)";

  return (
    <div className="space-y-8">
      {/* ── Spend against ceiling ── */}
      <div
        className="rounded-md border p-5 space-y-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="font-mono text-2xl" style={{ color: "var(--color-ink)" }}>
              {usd(budget.spent)}{" "}
              <span className="text-base" style={{ color: "var(--color-muted)" }}>
                / {usd(budget.ceiling)}
              </span>
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
              {budget.runs} run{budget.runs === 1 ? "" : "s"} since{" "}
              {budget.since === 0 ? "the beginning" : when(budget.since)}
            </p>
          </div>
          {budget.exhausted && (
            <span
              className="rounded px-2.5 py-1 text-xs font-semibold"
              style={{ background: "rgba(239,68,68,0.12)", color: "#dc2626" }}
            >
              Limit reached — discovery blocked
            </span>
          )}
        </div>

        <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: "var(--color-bg)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
        </div>

        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Checked before every actor run, not once per sweep — a sweep issues up to a dozen runs and stops
          mid-way when the ceiling is hit. Costs are Apify&rsquo;s own <code>usageTotalUsd</code> per run, so
          this total is what they bill. This is a second line of defence: the authoritative cap is the max
          spend setting in the Apify console.
        </p>
      </div>

      {/* ── Controls ── */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label
            className="block text-xs font-medium tracking-widest uppercase mb-1.5"
            style={{ color: "var(--color-muted)" }}
          >
            Ceiling (USD)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="1000"
              step="0.50"
              value={ceilingInput}
              onChange={(e) => setCeilingInput(e.target.value)}
              className="w-28 rounded border px-3 py-2 text-sm font-mono"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-ink)",
              }}
            />
            <button
              onClick={() => patch({ ceilingUsd: parseFloat(ceilingInput) }, "Ceiling updated.")}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
              style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
            >
              Save
            </button>
          </div>
        </div>

        <button
          onClick={() => patch({ enabled: !budget.enabled }, budget.enabled ? "Discovery disabled." : "Discovery enabled.")}
          disabled={busy}
          className="px-4 py-2 text-sm font-medium border transition disabled:opacity-50"
          style={{
            borderColor: budget.enabled ? "rgba(239,68,68,0.4)" : "var(--color-border)",
            color: budget.enabled ? "#dc2626" : "var(--color-ink)",
            borderRadius: "var(--radius)",
          }}
        >
          {budget.enabled ? "Disable discovery" : "Enable discovery"}
        </button>

        <button
          onClick={reset}
          disabled={busy}
          className="px-4 py-2 text-sm font-medium border transition disabled:opacity-50"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-muted)",
            borderRadius: "var(--radius)",
          }}
        >
          Reset counter
        </button>
      </div>

      {message && (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          {message}
        </p>
      )}

      {/* ── Ledger ── */}
      <div>
        <h2
          className="text-xs font-medium tracking-widest uppercase mb-3"
          style={{ color: "var(--color-muted)" }}
        >
          Recent runs
        </h2>
        {data.runs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            No Apify runs yet. Discovery falls back to the simulated crawler until{" "}
            <code>APIFY_TOKEN</code> is set.
          </p>
        ) : (
          <div
            className="rounded-md border overflow-x-auto"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {["When", "Query", "Items", "Cost", "Status"].map((h) => (
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
                {data.runs.map((run) => (
                  <tr key={run.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
                      {when(run.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-ink)" }}>
                      {run.mode}:{run.query}
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                      {run.itemCount}
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                      {usd(run.costUsd)}
                      {run.costEstimated && (
                        <span style={{ color: "var(--color-muted)" }} title="Run reported no usage figure">
                          {" "}
                          est.
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        style={{ color: run.status === "succeeded" ? "#16a34a" : "#dc2626" }}
                        title={run.error ?? undefined}
                      >
                        {run.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
