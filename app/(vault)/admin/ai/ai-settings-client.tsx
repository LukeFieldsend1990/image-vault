"use client";

import { useState, useCallback } from "react";

interface CostData {
  totalSpend: number;
  ceiling: number;
  byFeature: { feature: string; cost: number; calls: number }[];
  byProvider: { provider: string; cost: number; calls: number }[];
}

interface LastBatch {
  id: string;
  triggerType: string;
  status: string;
  initiatedByEmail: string | null;
  repsTargeted: number | null;
  repsProcessed: number | null;
  suggestionsCreated: number;
  skipped: string | null;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
}

interface LogEntry {
  id: string;
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  error: string | null;
  prompt: string | null;
  response: string | null;
  createdAt: number;
}

interface Props {
  initialSettings: Record<string, string>;
  initialCosts: CostData;
  recentBatchRuns: LastBatch[];
  recentLogs: LogEntry[];
}

function formatTimestamp(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(unix: number): string {
  const seconds = Math.floor(Date.now() / 1000) - unix;
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AiSettingsClient({ initialSettings, initialCosts, recentBatchRuns, recentLogs }: Props) {
  const [settings, setSettings] = useState(initialSettings);
  const [costs] = useState(initialCosts);
  const [saving, setSaving] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchStarted, setBatchStarted] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  const updateSetting = useCallback(async (key: string, value: string) => {
    setSaving(key);
    setSettings((prev) => ({ ...prev, [key]: value }));
    try {
      await fetch("/api/admin/ai/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
    } catch {
      // silently fail; user sees the optimistic update
    } finally {
      setSaving(null);
    }
  }, []);

  const toggleSetting = useCallback(
    (key: string) => {
      const current = settings[key] === "true";
      updateSetting(key, String(!current));
    },
    [settings, updateSetting],
  );

  const runBatch = useCallback(async () => {
    setBatchRunning(true);
    setBatchStarted(false);
    setBatchError(null);
    try {
      const res = await fetch("/api/admin/ai/run-batch", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      setBatchStarted(true);
    } catch (err: unknown) {
      setBatchError(err instanceof Error ? err.message : "Batch failed");
    } finally {
      setBatchRunning(false);
    }
  }, []);

  // Cost bar helpers
  const pct = costs.ceiling > 0 ? (costs.totalSpend / costs.ceiling) * 100 : 0;
  const barColor = pct > 80 ? "#dc2626" : pct > 50 ? "#d97706" : "#16a34a";
  const projected = costs.totalSpend * 2; // simple 14-day projection from current 14-day window

  const cardStyle: React.CSSProperties = {
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    background: "var(--color-surface)",
  };

  const headerStyle: React.CSSProperties = {
    padding: "14px 20px",
    borderBottom: "1px solid var(--color-border)",
  };

  const labelStyle: React.CSSProperties = {
    color: "var(--color-muted)",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    fontWeight: 600,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ── Settings Panel ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={headerStyle}>
          <h2 style={labelStyle}>Settings</h2>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Master switch */}
          <ToggleRow
            label="AI Features Master Switch"
            sublabel={settings["enabled"] === "true" ? "Enabled" : "Disabled"}
            checked={settings["enabled"] === "true"}
            saving={saving === "enabled"}
            onToggle={() => toggleSetting("enabled")}
          />

          {/* Fee guidance */}
          <ToggleRow
            label="Fee Guidance"
            sublabel="Off by default"
            checked={settings["fee_guidance_enabled"] === "true"}
            saving={saving === "fee_guidance_enabled"}
            onToggle={() => toggleSetting("fee_guidance_enabled")}
          />

          {/* Licence summaries */}
          <ToggleRow
            label="Licence Summaries"
            sublabel="Off by default"
            checked={settings["licence_summary_enabled"] === "true"}
            saving={saving === "licence_summary_enabled"}
            onToggle={() => toggleSetting("licence_summary_enabled")}
          />

          {/* Budget ceiling */}
          <InputRow
            label="Budget Ceiling (USD)"
            value={settings["budget_ceiling_usd"] ?? "50"}
            saving={saving === "budget_ceiling_usd"}
            onCommit={(v) => updateSetting("budget_ceiling_usd", v)}
          />

          {/* Max security alerts */}
          <InputRow
            label="Max Security Alerts / Day"
            value={settings["max_security_alerts_per_day"] ?? "10"}
            saving={saving === "max_security_alerts_per_day"}
            onCommit={(v) => updateSetting("max_security_alerts_per_day", v)}
          />
        </div>
      </div>

      {/* ── Cost Summary Panel ─────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={headerStyle}>
          <h2 style={labelStyle}>Cost Summary (Last 14 Days)</h2>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Total spend bar */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-ink)" }}>
                ${costs.totalSpend.toFixed(4)} / ${costs.ceiling.toFixed(2)}
              </span>
              <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
                {pct.toFixed(1)}%
              </span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                background: "var(--color-border)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(pct, 100)}%`,
                  borderRadius: 4,
                  background: barColor,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <p style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 6 }}>
              Projected 14-day spend: ${projected.toFixed(4)}
            </p>
          </div>

          {/* By feature table */}
          {costs.byFeature.length > 0 && (
            <div>
              <h3
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--color-muted)",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                By Feature
              </h3>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <Th>Feature</Th>
                    <Th align="right">Cost</Th>
                    <Th align="right">Calls</Th>
                  </tr>
                </thead>
                <tbody>
                  {costs.byFeature.map((r) => (
                    <tr key={r.feature}>
                      <Td>{r.feature}</Td>
                      <Td align="right">${r.cost.toFixed(4)}</Td>
                      <Td align="right">{r.calls}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* By provider table */}
          {costs.byProvider.length > 0 && (
            <div>
              <h3
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--color-muted)",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                By Provider
              </h3>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <Th>Provider</Th>
                    <Th align="right">Cost</Th>
                    <Th align="right">Calls</Th>
                  </tr>
                </thead>
                <tbody>
                  {costs.byProvider.map((r) => (
                    <tr key={r.provider}>
                      <Td>{r.provider}</Td>
                      <Td align="right">${r.cost.toFixed(4)}</Td>
                      <Td align="right">{r.calls}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {costs.byFeature.length === 0 && costs.byProvider.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--color-muted)" }}>
              No AI cost data recorded in the last 14 days.
            </p>
          )}
        </div>
      </div>

      {/* ── Manual Batch Trigger ───────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={headerStyle}>
          <h2 style={labelStyle}>Manual Batch Trigger</h2>
        </div>
        <div style={{ padding: 20 }}>
          {recentBatchRuns[0] && (
            <div
              style={{
                marginBottom: 16,
                padding: "10px 14px",
                borderRadius: 6,
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                fontSize: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span style={{ fontWeight: 600, color: "var(--color-ink)" }}>Latest run:</span>{" "}
                <span style={{ color: "var(--color-muted)" }}>
                  {formatTimestamp(recentBatchRuns[0].startedAt)} ({timeAgo(recentBatchRuns[0].startedAt)})
                </span>
              </div>
              <span style={{ color: "var(--color-ink)", fontWeight: 500 }}>
                {recentBatchRuns[0].status}
              </span>
            </div>
          )}

          <p style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 12 }}>
            Run the suggestion-generation batch job on demand. This processes all reps and creates
            new AI suggestions.
          </p>
          <button
            onClick={runBatch}
            disabled={batchRunning}
            style={{
              padding: "8px 20px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: "none",
              cursor: batchRunning ? "wait" : "pointer",
              background: batchRunning ? "var(--color-border)" : "var(--color-accent)",
              color: "#fff",
              opacity: batchRunning ? 0.7 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {batchRunning ? "Starting..." : "Run Batch Now"}
          </button>

          {batchStarted && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 14px",
                borderRadius: 6,
                background: "rgba(22,163,74,0.08)",
                border: "1px solid rgba(22,163,74,0.2)",
                fontSize: 12,
                color: "#166534",
              }}
            >
              Batch started in background. Refresh this page to inspect the run status below.
            </div>
          )}

          {batchError && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 14px",
                borderRadius: 6,
                background: "rgba(220,38,38,0.08)",
                border: "1px solid rgba(220,38,38,0.2)",
                fontSize: 12,
                color: "#991b1b",
              }}
            >
              Error: {batchError}
            </div>
          )}
        </div>
      </div>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <h2 style={labelStyle}>Recent Batch Runs</h2>
        </div>
        <div style={{ padding: 20 }}>
          {recentBatchRuns.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--color-muted)" }}>No batch runs recorded yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {recentBatchRuns.map((run) => (
                <BatchRunCard key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>
      </div>
      {/* ── AI Call Logs ────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={headerStyle}>
          <h2 style={labelStyle}>Recent AI Calls (Last 20)</h2>
        </div>
        <div style={{ padding: 20 }}>
          {recentLogs.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--color-muted)" }}>No AI calls recorded yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {recentLogs.map((log) => (
                <LogCard key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────────── */

function BatchRunCard({ run }: { run: LastBatch }) {
  const [expanded, setExpanded] = useState(false);
  const isError = run.status === "failed";
  const isStarted = run.status === "started";
  const skipped = run.skipped ? JSON.parse(run.skipped) as string[] : [];

  return (
    <div
      style={{
        border: isError ? "1px solid rgba(220,38,38,0.3)" : "1px solid var(--color-border)",
        borderRadius: 6,
        background: isError ? "rgba(220,38,38,0.04)" : "var(--color-surface)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          padding: "10px 14px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: isError ? "rgba(220,38,38,0.12)" : isStarted ? "rgba(217,119,6,0.12)" : "rgba(22,163,74,0.12)",
              color: isError ? "#991b1b" : isStarted ? "#9a3412" : "#166534",
              textTransform: "uppercase",
            }}
          >
            {run.status}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink)" }}>
            {run.triggerType}
          </span>
          <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
            {run.suggestionsCreated} suggestion{run.suggestionsCreated !== 1 ? "s" : ""}
          </span>
          {typeof run.repsProcessed === "number" && (
            <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
              {run.repsProcessed}/{run.repsTargeted ?? run.repsProcessed} reps
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
            {timeAgo(run.startedAt)}
          </span>
          <span style={{ fontSize: 10, color: "var(--color-muted)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
            ▼
          </span>
        </div>
      </button>
      {expanded && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ fontSize: 11, color: "var(--color-muted)", margin: 0 }}>
            Started: {formatTimestamp(run.startedAt)}
            {run.completedAt ? ` · Completed: ${formatTimestamp(run.completedAt)}` : ""}
          </p>
          {run.initiatedByEmail && (
            <p style={{ fontSize: 11, color: "var(--color-muted)", margin: 0 }}>
              Initiated by: {run.initiatedByEmail}
            </p>
          )}
          <p style={{ fontSize: 11, color: "var(--color-muted)", margin: 0 }}>
            Batch ID: {run.id}
          </p>
          {run.error && (
            <pre style={{ fontSize: 11, color: "#991b1b", background: "rgba(220,38,38,0.06)", padding: 8, borderRadius: 4, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>
              {run.error}
            </pre>
          )}
          {skipped.length > 0 && (
            <pre style={{ fontSize: 11, color: "var(--color-ink)", background: "var(--color-border)", padding: 8, borderRadius: 4, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0, maxHeight: 180, overflow: "auto" }}>
              {JSON.stringify(skipped, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function LogCard({ log }: { log: LogEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        border: log.error ? "1px solid rgba(220,38,38,0.3)" : "1px solid var(--color-border)",
        borderRadius: 6,
        background: log.error ? "rgba(220,38,38,0.04)" : "var(--color-surface)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          padding: "10px 14px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: log.error ? "rgba(220,38,38,0.12)" : "rgba(22,163,74,0.12)",
              color: log.error ? "#991b1b" : "#166534",
              textTransform: "uppercase",
            }}
          >
            {log.error ? "error" : "ok"}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink)" }}>
            {log.feature}
          </span>
          <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
            {log.provider}/{log.model.split("/").pop()}
          </span>
          <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
            {log.inputTokens + log.outputTokens} tok
          </span>
          <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
            ${log.cost.toFixed(4)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
            {timeAgo(log.createdAt)}
          </span>
          <span style={{ fontSize: 10, color: "var(--color-muted)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
            ▼
          </span>
        </div>
      </button>

      {expanded && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {log.error && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 600, color: "#991b1b", marginBottom: 4, textTransform: "uppercase" }}>Error</p>
              <pre style={{ fontSize: 11, color: "#991b1b", background: "rgba(220,38,38,0.06)", padding: 8, borderRadius: 4, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>
                {log.error}
              </pre>
            </div>
          )}
          {log.prompt && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 600, color: "var(--color-muted)", marginBottom: 4, textTransform: "uppercase" }}>Prompt</p>
              <pre style={{ fontSize: 11, color: "var(--color-ink)", background: "var(--color-border)", padding: 8, borderRadius: 4, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0, maxHeight: 200, overflow: "auto" }}>
                {log.prompt}
              </pre>
            </div>
          )}
          {log.response && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 600, color: "var(--color-muted)", marginBottom: 4, textTransform: "uppercase" }}>Response</p>
              <pre style={{ fontSize: 11, color: "var(--color-ink)", background: "var(--color-border)", padding: 8, borderRadius: 4, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0, maxHeight: 300, overflow: "auto" }}>
                {log.response}
              </pre>
            </div>
          )}
          {!log.prompt && !log.response && !log.error && (
            <p style={{ fontSize: 11, color: "var(--color-muted)", fontStyle: "italic" }}>
              No prompt/response data logged for this call (pre-logging update).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  sublabel,
  checked,
  saving,
  onToggle,
}: {
  label: string;
  sublabel: string;
  checked: boolean;
  saving: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div>
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-ink)" }}>{label}</p>
        <p style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>{sublabel}</p>
      </div>
      <button
        onClick={onToggle}
        disabled={saving}
        style={{
          position: "relative",
          width: 40,
          height: 22,
          borderRadius: 11,
          border: "none",
          cursor: saving ? "wait" : "pointer",
          background: checked ? "var(--color-accent)" : "var(--color-border)",
          transition: "background 0.2s",
          flexShrink: 0,
        }}
        aria-pressed={checked}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
          }}
        />
      </button>
    </div>
  );
}

function InputRow({
  label,
  value,
  saving,
  onCommit,
}: {
  label: string;
  value: string;
  saving: boolean;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-ink)" }}>{label}</p>
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== value) onCommit(local);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        disabled={saving}
        style={{
          width: 100,
          padding: "6px 10px",
          fontSize: 12,
          borderRadius: 6,
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-ink)",
          textAlign: "right",
          outline: "none",
        }}
      />
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        fontSize: 10,
        fontWeight: 600,
        color: "var(--color-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        padding: "6px 8px",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        textAlign: align,
        fontSize: 12,
        color: "var(--color-ink)",
        padding: "8px 8px",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {children}
    </td>
  );
}
