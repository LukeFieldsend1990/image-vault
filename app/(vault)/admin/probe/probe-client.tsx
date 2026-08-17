"use client";

import { useCallback, useEffect, useState } from "react";

interface ProbeRunRow {
  run: {
    id: string;
    talentId: string;
    targetKind: string;
    targetRef: string;
    status: string;
    samplesTotal: number;
    samplesScored: number;
    costEstimateUsd: number;
    costActualUsd: number;
    verdictJson: string | null;
    sealRef: string | null;
    createdAt: number;
  };
  talentName: string | null;
}

interface Verdict {
  encoding: "strong" | "moderate" | "weak" | "none";
  targetMatchRate: number;
  controlMatchRate: number;
  fisherP: number;
  scanMembershipSignal: boolean;
}

interface Budget {
  ceilingUsd: number;
  spentUsd: number;
  remainingUsd: number;
  estimateUsd: number;
  reason?: string;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

function when(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ENCODING_COLOR: Record<string, string> = {
  strong: "#bc3d2c",
  moderate: "#c0883b",
  weak: "#c0883b",
  none: "var(--color-muted)",
};

export default function ProbeClient() {
  const [runs, setRuns] = useState<ProbeRunRow[]>([]);
  const [talentId, setTalentId] = useState("");
  const [civitai, setCivitai] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingBudget, setPendingBudget] = useState<Budget | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/probe/runs");
    if (!res.ok) return;
    const payload = (await res.json()) as { runs: ProbeRunRow[] };
    setRuns(payload.runs);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (confirmSpend: boolean) => {
      if (!talentId.trim() || !civitai.trim()) {
        setMessage("Talent id and a Civitai model id/URL are both required.");
        return;
      }
      setBusy(true);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/probe/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            talentId: talentId.trim(),
            civitaiModelIdOrUrl: civitai.trim(),
            confirmSpend,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          runId?: string;
          estimateUsd?: number;
          budget?: Budget;
          warnings?: string[];
        };
        if (payload.ok) {
          setMessage(
            `Run ${payload.runId?.slice(0, 8)} started (est. ${usd(payload.estimateUsd ?? 0)}).${
              payload.warnings?.length ? " " + payload.warnings.join(" ") : ""
            }`
          );
          setPendingBudget(null);
          setCivitai("");
          await load();
        } else if (payload.budget && !confirmSpend) {
          // Cost preview — show the confirm step.
          setPendingBudget({ ...payload.budget });
          setMessage(payload.warnings?.length ? payload.warnings.join(" ") : null);
        } else {
          setMessage(payload.error ?? "Could not start the run.");
          setPendingBudget(null);
        }
      } finally {
        setBusy(false);
      }
    },
    [talentId, civitai, load]
  );

  return (
    <div className="space-y-8">
      <div
        className="rounded-md border p-5 space-y-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <h2 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Start a probe run
        </h2>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Interrogates a generative model to test whether it encodes the talent&rsquo;s likeness, scoring
          generated images against the vault reference set and a control cohort. Costs real money per run and
          is checked against the probe budget. Enable AWS Rekognition creds for identity scoring; without them
          the run measures derivation (pHash) only.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label
              className="block text-xs font-medium tracking-widest uppercase mb-1.5"
              style={{ color: "var(--color-muted)" }}
            >
              Talent id
            </label>
            <input
              value={talentId}
              onChange={(e) => {
                setTalentId(e.target.value);
                setPendingBudget(null);
              }}
              placeholder="user uuid"
              className="w-72 rounded border px-3 py-2 text-sm font-mono"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}
            />
          </div>
          <div>
            <label
              className="block text-xs font-medium tracking-widest uppercase mb-1.5"
              style={{ color: "var(--color-muted)" }}
            >
              Civitai model (id or URL)
            </label>
            <input
              value={civitai}
              onChange={(e) => {
                setCivitai(e.target.value);
                setPendingBudget(null);
              }}
              placeholder="https://civitai.com/models/12345"
              className="w-72 rounded border px-3 py-2 text-sm font-mono"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}
            />
          </div>
          {!pendingBudget ? (
            <button
              onClick={() => submit(false)}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
              style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
            >
              Estimate cost
            </button>
          ) : (
            <button
              onClick={() => submit(true)}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
              style={{ background: "var(--color-accent)", borderRadius: "var(--radius)" }}
            >
              Confirm &amp; spend {usd(pendingBudget.estimateUsd)}
            </button>
          )}
        </div>

        {pendingBudget && (
          <div
            className="rounded border p-3 text-xs"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
          >
            Estimated <strong>{usd(pendingBudget.estimateUsd)}</strong>. Budget: {usd(pendingBudget.spentUsd)} spent
            of {usd(pendingBudget.ceilingUsd)} (14-day window), {usd(pendingBudget.remainingUsd)} remaining.
            {pendingBudget.reason ? ` ${pendingBudget.reason}` : " Confirm to start the run."}
          </div>
        )}

        {message && (
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            {message}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
            Recent runs
          </h2>
          <button
            onClick={() => void load()}
            className="text-xs underline underline-offset-2"
            style={{ color: "var(--color-muted)" }}
          >
            Refresh
          </button>
        </div>
        {runs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            No probe runs yet.
          </p>
        ) : (
          <div
            className="rounded-md border overflow-x-auto"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {["When", "Talent", "Target", "Status", "Verdict", "Cost", "Report"].map((h) => (
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
                {runs.map(({ run, talentName }) => {
                  const verdict = run.verdictJson ? (JSON.parse(run.verdictJson) as Verdict) : null;
                  return (
                    <tr key={run.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
                        {when(run.createdAt)}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: "var(--color-ink)" }}>
                        {talentName ?? run.talentId.slice(0, 8)}
                      </td>
                      <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                        {run.targetKind === "civitai_lora" ? "LoRA" : "hosted"} {run.targetRef}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: "var(--color-text)" }}>
                        {run.status}
                        {run.status !== "complete" && run.status !== "failed" && run.samplesTotal > 0 && (
                          <span style={{ color: "var(--color-muted)" }}>
                            {" "}
                            {run.samplesScored}/{run.samplesTotal}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {verdict ? (
                          <span style={{ color: ENCODING_COLOR[verdict.encoding] }} title={`target ${pct(verdict.targetMatchRate)} vs control ${pct(verdict.controlMatchRate)}, p=${verdict.fisherP.toFixed(3)}`}>
                            {verdict.encoding}
                            {verdict.scanMembershipSignal ? " · scan-match" : ""}
                          </span>
                        ) : (
                          <span style={{ color: "var(--color-muted)" }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                        {usd(run.costActualUsd || run.costEstimateUsd)}
                      </td>
                      <td className="px-4 py-2.5">
                        {run.status === "complete" ? (
                          <a
                            href={`/api/admin/probe/runs/${run.id}/report`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2"
                            style={{ color: "var(--color-accent)" }}
                          >
                            open
                          </a>
                        ) : (
                          <span style={{ color: "var(--color-muted)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
