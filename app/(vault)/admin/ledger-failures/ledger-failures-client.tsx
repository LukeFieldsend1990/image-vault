"use client";

import { useCallback, useEffect, useState } from "react";
import { isoUtc } from "@/lib/documents/palette";
import type { LedgerFailuresResponse } from "@/app/api/admin/ledger-failures/route";
import type { AppendFailure } from "@/lib/compliance/failures";

type Filter = "unresolved" | "replayed" | "dismissed" | "all";

const STATUS_TONE: Record<AppendFailure["status"], string> = {
  unresolved: "var(--color-danger)",
  replayed: "var(--color-active)",
  dismissed: "var(--color-muted)",
};

export default function LedgerFailuresClient() {
  const [data, setData] = useState<LedgerFailuresResponse | null>(null);
  const [filter, setFilter] = useState<Filter>("unresolved");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f: Filter) => {
    setLoading(true);
    try {
      const qs = f === "all" ? "" : `?status=${f}`;
      const r = await fetch(`/api/admin/ledger-failures${qs}`);
      if (!r.ok) throw new Error(`Failed to load (${r.status})`);
      setData((await r.json()) as LedgerFailuresResponse);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function act(id: string, action: "replay" | "dismiss") {
    let note = "";
    if (action === "dismiss") {
      const entered = window.prompt("Why is this failure being dismissed? (recorded against it)");
      if (entered === null) return;
      note = entered.trim();
      if (!note) {
        setError("A reason is required to dismiss a failure.");
        return;
      }
    }
    setBusy(id);
    setError(null);
    try {
      const r = await fetch("/api/admin/ledger-failures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, note }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string; seq?: number };
      if (!r.ok || !d.ok) {
        setError(d.error ?? "Action failed");
        return;
      }
      await load(filter);
    } finally {
      setBusy(null);
    }
  }

  const card = "rounded p-4";
  const cardStyle = { border: "1px solid var(--color-border)", background: "var(--color-surface)" };

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Ledger append failures
        </h1>
        <p className="text-xs mt-1" style={{ color: "var(--color-muted)", lineHeight: 1.65, maxWidth: "68ch" }}>
          Compliance events that could not be written to the hash chain. This list
          exists because a dropped append is invisible in the chain itself — the
          sequence number is taken from the tip at write time, so an event that
          never landed leaves a chain that is shorter than it should be yet still
          verifies cleanly. Nothing downstream can detect it, which is why the
          failure is recorded here at the moment it happens.
        </p>
      </div>

      {data && data.unresolvedCount > 0 && (
        <div
          className={card}
          style={{ ...cardStyle, borderLeft: "3px solid var(--color-danger)", background: "var(--color-accent-tint)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink)" }}>
            <strong>{data.unresolvedCount}</strong> unresolved{" "}
            {data.unresolvedCount === 1 ? "failure" : "failures"}. Each one is an event that
            should be on a chain and is not.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {(["unresolved", "replayed", "dismissed", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className="text-xs px-3 py-1.5 rounded capitalize transition"
            style={{
              border: `1px solid ${filter === f ? "var(--color-accent)" : "var(--color-border)"}`,
              background: filter === f ? "var(--color-accent-tint)" : "var(--color-bg)",
              color: filter === f ? "var(--color-accent)" : "var(--color-muted)",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {error && (
        <p
          className="text-xs rounded px-3 py-2"
          style={{ background: "var(--color-accent-tint)", color: "var(--color-danger)" }}
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading…</p>
      ) : !data || data.failures.length === 0 ? (
        <div className={card} style={cardStyle}>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            {filter === "unresolved"
              ? "No unresolved failures. Every ledger append has landed."
              : "Nothing here."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {data.failures.map((f) => (
            <div key={f.id} className={card} style={cardStyle}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
                      style={{ color: STATUS_TONE[f.status], border: `1px solid ${STATUS_TONE[f.status]}` }}
                    >
                      {f.status}
                    </span>
                    <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                      {f.eventType}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono mt-1.5" style={{ color: "var(--color-muted)" }}>
                    {f.chainKey}
                  </p>
                  {f.errorMessage && (
                    <p
                      className="text-[11px] mt-2 rounded px-2.5 py-1.5"
                      style={{ background: "var(--color-bg)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                    >
                      {f.errorMessage}
                    </p>
                  )}
                  {f.note && (
                    <p className="text-[11px] mt-2 italic" style={{ color: "var(--color-muted)" }}>
                      &ldquo;{f.note}&rdquo;
                    </p>
                  )}
                  {f.status === "replayed" && f.replayedSeq != null && (
                    <p className="text-[11px] mt-2" style={{ color: "var(--color-active)" }}>
                      Replayed onto the chain at sequence {f.replayedSeq}
                      {f.replayedAt ? ` on ${isoUtc(f.replayedAt)}` : ""}.
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className="text-[10px] font-mono" style={{ color: "var(--color-muted)" }}>
                    {isoUtc(f.createdAt)}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--color-faint)" }}>
                    {f.attempts} attempt{f.attempts === 1 ? "" : "s"}
                  </p>
                  {f.status === "unresolved" && (
                    <div className="flex items-center gap-2 mt-2 justify-end">
                      <button
                        type="button"
                        disabled={busy === f.id}
                        onClick={() => act(f.id, "replay")}
                        className="text-xs px-3 py-1.5 rounded font-medium text-white"
                        style={{ background: busy === f.id ? "var(--color-muted)" : "var(--color-accent)" }}
                      >
                        {busy === f.id ? "Working…" : "Replay"}
                      </button>
                      <button
                        type="button"
                        disabled={busy === f.id}
                        onClick={() => act(f.id, "dismiss")}
                        className="text-xs"
                        style={{ color: "var(--color-muted)" }}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px]" style={{ color: "var(--color-muted)", lineHeight: 1.65, maxWidth: "68ch" }}>
        Replaying appends the event at the chain&apos;s current tip, not at the position it
        would originally have held — an append-only chain cannot take an insertion without
        breaking every hash after it. The replayed entry carries the original failure time in
        its payload, so the record stays honest about when the event actually occurred.
      </p>
    </div>
  );
}
