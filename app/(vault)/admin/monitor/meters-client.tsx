"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Meter {
  talentId: string;
  name: string | null;
  email: string | null;
  plan: string;
  allowanceUsd: number | null;
  overrideUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  unmetered: boolean;
  exhausted: boolean;
  periodStart: number;
  runs: number;
}

interface PlanDef {
  id: string;
  label: string;
  monthlyAllowanceUsd: number | null;
}

interface Payload {
  meters: Meter[];
  plans: PlanDef[];
}

const usd = (n: number) => `$${n.toFixed(2)}`;

function periodLabel(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default function MetersClient() {
  const [data, setData] = useState<Payload | null>(null);
  // One in-flight update at a time, keyed by talent, so a slow PUT can't be
  // stacked with a second edit to the same row.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/monitor/meters");
    if (!res.ok) return;
    const payload = (await res.json()) as Payload;
    setData(payload);
    setOverrideDrafts(
      Object.fromEntries(
        payload.meters.map((m) => [m.talentId, m.overrideUsd === null ? "" : m.overrideUsd.toFixed(2)])
      )
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const put = useCallback(
    async (talentId: string, body: Record<string, unknown>, note: string) => {
      setBusyId(talentId);
      setMessage(null);
      try {
        const res = await fetch(`/api/admin/talent/${talentId}/monitor-plan`, {
          method: "PUT",
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
        setBusyId(null);
      }
    },
    [load]
  );

  // Exhausted meters first — they're the rows an admin came here to act on —
  // then by spend, so the expensive talent stay visible above the idle ones.
  const sorted = useMemo(
    () =>
      data
        ? [...data.meters].sort(
            (a, b) => Number(b.exhausted) - Number(a.exhausted) || b.spentUsd - a.spentUsd
          )
        : [],
    [data]
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Per-talent meters{sorted.length ? ` — ${periodLabel(sorted[0].periodStart)}` : ""}
        </h2>
        <p className="text-xs mt-1.5 max-w-2xl" style={{ color: "var(--color-muted)" }}>
          Each talent&rsquo;s plan sets a monthly discovery allowance, enforced between every actor run on
          top of the shared ceiling above. An exhausted meter stops paid discovery for that talent only —
          free surfaces keep running and the monitor stays on. An explicit allowance overrides the plan
          default; allowance amounts are provisional pending commercial sign-off.
        </p>
      </div>

      {!data ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Loading…
        </p>
      ) : sorted.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No monitors yet. A talent&rsquo;s meter appears after their first sweep (or once a plan is
          assigned from their roster page).
        </p>
      ) : (
        <div
          className="rounded-md border overflow-x-auto"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["Talent", "Plan", "Allowance (USD)", "Spent", "Remaining", "Runs"].map((h) => (
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
              {sorted.map((m) => {
                const busy = busyId === m.talentId;
                const pct =
                  m.allowanceUsd !== null && m.allowanceUsd > 0
                    ? Math.min(100, (m.spentUsd / m.allowanceUsd) * 100)
                    : 0;
                const spentColor = m.exhausted ? "#dc2626" : pct > 75 ? "#d97706" : "var(--color-text)";
                return (
                  <tr key={m.talentId} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td className="px-4 py-2.5">
                      <span style={{ color: "var(--color-ink)" }}>{m.name ?? m.email ?? m.talentId}</span>
                      {m.exhausted && (
                        <span
                          className="ml-2 rounded px-1.5 py-0.5 font-semibold"
                          style={{ background: "rgba(239,68,68,0.12)", color: "#dc2626" }}
                        >
                          exhausted
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={m.plan}
                        disabled={busy}
                        onChange={(e) =>
                          void put(m.talentId, { plan: e.target.value }, `Plan set to ${e.target.value}.`)
                        }
                        className="rounded border px-2 py-1.5 disabled:opacity-50"
                        style={{
                          borderColor: "var(--color-border)",
                          background: "var(--color-surface)",
                          color: "var(--color-ink)",
                        }}
                      >
                        {data.plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                            {p.monthlyAllowanceUsd !== null ? ` (${usd(p.monthlyAllowanceUsd)}/mo)` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          max="1000"
                          step="0.50"
                          placeholder={m.allowanceUsd === null ? "unmetered" : usd(m.allowanceUsd)}
                          value={overrideDrafts[m.talentId] ?? ""}
                          disabled={busy}
                          onChange={(e) =>
                            setOverrideDrafts((d) => ({ ...d, [m.talentId]: e.target.value }))
                          }
                          className="w-24 rounded border px-2 py-1.5 font-mono disabled:opacity-50"
                          style={{
                            borderColor: "var(--color-border)",
                            background: "var(--color-surface)",
                            color: "var(--color-ink)",
                          }}
                        />
                        <button
                          onClick={() => {
                            const raw = (overrideDrafts[m.talentId] ?? "").trim();
                            if (raw === "") {
                              void put(m.talentId, { monthlyBudgetUsd: null }, "Override cleared — plan default applies.");
                            } else {
                              void put(m.talentId, { monthlyBudgetUsd: parseFloat(raw) }, "Allowance override saved.");
                            }
                          }}
                          disabled={busy}
                          className="px-2.5 py-1.5 font-medium border transition disabled:opacity-50"
                          style={{
                            borderColor: "var(--color-border)",
                            color: "var(--color-ink)",
                            borderRadius: "var(--radius)",
                          }}
                          title="Save the override; save empty to fall back to the plan default"
                        >
                          Set
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap" style={{ color: spentColor }}>
                      {usd(m.spentUsd)}
                      {m.allowanceUsd !== null && (
                        <span style={{ color: "var(--color-muted)" }}> / {usd(m.allowanceUsd)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                      {m.unmetered ? (
                        <span style={{ color: "var(--color-muted)" }}>unmetered</span>
                      ) : (
                        <span style={{ color: m.exhausted ? "#dc2626" : "var(--color-text)" }}>
                          {usd(m.remainingUsd ?? 0)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                      {m.runs}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {message && (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          {message}
        </p>
      )}
    </div>
  );
}
