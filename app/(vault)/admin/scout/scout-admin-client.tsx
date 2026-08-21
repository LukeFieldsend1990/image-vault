"use client";

import { useCallback, useEffect, useState } from "react";

interface ScoutSettings {
  enabled: boolean;
  runLimitDefault: number;
}

interface AdminTrialRow {
  id: string;
  requesterEmail: string;
  requesterRole: string | null;
  tmdbId: number;
  tmdbName: string;
  status: string;
  hitsFound: number;
  candidatesAnalysed: number;
  aiProvider: string | null;
  converted: boolean;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  costUsd: number;
}

interface AllowanceRow {
  userId: string;
  email: string;
  role: string | null;
  extraRuns: number;
  used: number;
  updatedAt: number;
}

interface AdminScoutPayload {
  settings: ScoutSettings;
  trials: AdminTrialRow[];
  allowances: AllowanceRow[];
}

const STATUS_COLORS: Record<string, string> = {
  draft: "var(--color-muted)",
  running: "#b8860b",
  complete: "#2d7a4f",
  error: "var(--color-accent)",
};

function formatDate(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ScoutAdminClient() {
  const [data, setData] = useState<AdminScoutPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [grantEmail, setGrantEmail] = useState("");
  const [grantRuns, setGrantRuns] = useState("3");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/scout");
    if (!res.ok) return;
    const payload = (await res.json()) as AdminScoutPayload;
    setData(payload);
    setLimitInput(String(payload.settings.runLimitDefault));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchSetting = useCallback(
    async (key: string, value: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/scout/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setMessage(err.error ?? "Update failed");
          return;
        }
        setMessage("Saved");
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const grant = useCallback(async () => {
    const extraRuns = parseInt(grantRuns, 10);
    if (!grantEmail.trim() || !Number.isFinite(extraRuns)) {
      setMessage("Email and a whole number of runs are required");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/scout/allowances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: grantEmail.trim(), extraRuns }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage(payload.error ?? "Grant failed");
        return;
      }
      setMessage(`Granted ${extraRuns} extra run${extraRuns === 1 ? "" : "s"} to ${grantEmail.trim()}`);
      setGrantEmail("");
      await load();
    } finally {
      setBusy(false);
    }
  }, [grantEmail, grantRuns, load]);

  if (!data) {
    return (
      <section className="text-xs" style={{ color: "var(--color-muted)" }}>
        Loading trial ledger…
      </section>
    );
  }

  const totalSpend = data.trials.reduce((sum, t) => sum + t.costUsd, 0);
  const totalHits = data.trials.reduce((sum, t) => sum + t.hitsFound, 0);
  const converted = data.trials.filter((t) => t.converted).length;

  return (
    <div className="space-y-8">
      {message && (
        <div
          className="text-xs px-3 py-2 rounded"
          style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
        >
          {message}
        </div>
      )}

      {/* Controls */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Controls
        </h2>
        <div
          className="rounded p-4 space-y-4"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                Trial sweeps
              </p>
              <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                Switching off hides the Scout surface and refuses new runs. Completed trials keep
                their results.
              </p>
            </div>
            <button
              onClick={() => void patchSetting("trial_scans_enabled", data.settings.enabled ? "false" : "true")}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded shrink-0"
              style={{
                background: data.settings.enabled ? "var(--color-accent)" : "var(--color-surface)",
                color: data.settings.enabled ? "white" : "var(--color-muted)",
                border: data.settings.enabled ? "none" : "1px solid var(--color-border)",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {data.settings.enabled ? "On" : "Off"}
            </button>
          </div>
          <hr style={{ borderColor: "var(--color-border)" }} />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                Runs per account
              </p>
              <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                The default allowance for every rep and production account. Per-account extras
                below stack on top.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="number"
                min={0}
                max={100}
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                className="w-16 text-sm px-2 py-1.5 rounded text-right"
                style={{
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-ink)",
                }}
              />
              <button
                onClick={() => void patchSetting("trial_runs_default", limitInput)}
                disabled={busy || limitInput === String(data.settings.runLimitDefault)}
                className="text-xs px-3 py-1.5 rounded"
                style={{
                  border: "1px solid var(--color-border)",
                  color: "var(--color-ink)",
                  opacity: busy || limitInput === String(data.settings.runLimitDefault) ? 0.5 : 1,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Ledger summary */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Trials run", value: String(data.trials.filter((t) => t.status !== "draft").length) },
          { label: "Hits surfaced", value: String(totalHits) },
          { label: "Subjects onboarded", value: String(converted) },
          { label: "Discovery spend", value: `$${totalSpend.toFixed(2)}` },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded p-4"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
          >
            <p className="text-xs uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              {card.label}
            </p>
            <p className="mt-1 text-xl font-semibold" style={{ color: "var(--color-ink)", fontFamily: "var(--font-mono, monospace)" }}>
              {card.value}
            </p>
          </div>
        ))}
      </section>

      {/* Extra runs */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Extra runs
        </h2>
        <div
          className="rounded p-4 space-y-4"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-48">
              <span className="block text-xs mb-1" style={{ color: "var(--color-muted)" }}>
                Account email
              </span>
              <input
                type="email"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
                placeholder="rep@agency.com"
                className="w-full text-sm px-2 py-1.5 rounded"
                style={{
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-ink)",
                }}
              />
            </label>
            <label>
              <span className="block text-xs mb-1" style={{ color: "var(--color-muted)" }}>
                Extra runs
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={grantRuns}
                onChange={(e) => setGrantRuns(e.target.value)}
                className="w-20 text-sm px-2 py-1.5 rounded text-right"
                style={{
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-ink)",
                }}
              />
            </label>
            <button
              onClick={() => void grant()}
              disabled={busy}
              className="text-xs px-3 py-2 rounded"
              style={{ background: "var(--color-accent)", color: "white", opacity: busy ? 0.6 : 1 }}
            >
              Grant
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            The grant is an absolute number stacked on the default — re-submit with a lower value
            to reduce it, or 0 to revoke.
          </p>
          {data.allowances.length > 0 && (
            <div className="space-y-2">
              {data.allowances.map((a) => (
                <div key={a.userId} className="flex items-center justify-between text-sm gap-3">
                  <span style={{ color: "var(--color-ink)" }}>
                    {a.email}
                    {a.role && (
                      <span className="ml-2 text-xs uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                        {a.role}
                      </span>
                    )}
                  </span>
                  <span className="text-xs shrink-0" style={{ color: "var(--color-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                    +{a.extraRuns} extra · {a.used} used
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Trial ledger */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Trial ledger
        </h2>
        {data.trials.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            No trials yet.
          </p>
        ) : (
          <div
            className="rounded overflow-x-auto"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Requested by</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Hits</th>
                  <th className="px-4 py-3 font-medium text-right">Spend</th>
                  <th className="px-4 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {data.trials.map((t) => (
                  <tr key={t.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td className="px-4 py-3" style={{ color: "var(--color-ink)" }}>
                      {t.tmdbName}
                      {t.converted && (
                        <span
                          className="ml-2 text-xs px-1.5 py-0.5 rounded uppercase tracking-widest"
                          style={{ background: "rgba(45,122,79,0.12)", color: "#2d7a4f" }}
                        >
                          Onboarded
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--color-muted)" }}>
                      {t.requesterEmail}
                    </td>
                    <td className="px-4 py-3">
                      <span style={{ color: STATUS_COLORS[t.status] ?? "var(--color-muted)" }} title={t.error ?? undefined}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" style={{ color: "var(--color-ink)", fontFamily: "var(--font-mono, monospace)" }}>
                      {t.status === "complete" ? t.hitsFound : "—"}
                    </td>
                    <td className="px-4 py-3 text-right" style={{ color: "var(--color-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                      ${t.costUsd.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--color-muted)" }}>
                      {formatDate(t.completedAt ?? t.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
