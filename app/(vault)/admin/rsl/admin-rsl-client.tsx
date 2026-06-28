"use client";

import { useEffect, useState } from "react";

type Light = "red" | "amber" | "green";

interface Item {
  talentId: string;
  email: string;
  name: string;
  profession: string | null;
  vaultLocked: boolean;
  adminApproved: boolean;
  overall: Light;
  live: boolean;
  publicUrl: string | null;
  approvedAt: number | null;
}

const LIGHT: Record<Light, { label: string; colour: string; dot: string }> = {
  green: { label: "Permitted", colour: "#166534", dot: "#16a34a" },
  amber: { label: "Permitted with terms", colour: "#b45309", dot: "#d97706" },
  red: { label: "Prohibited", colour: "#991b1b", dot: "#dc2626" },
};

export default function AdminRslClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/admin/rsl");
      const d = (await r.json()) as { items?: Item[]; error?: string };
      if (!r.ok) { setError(d.error ?? "Could not load."); return; }
      setItems(d.items ?? []);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function act(talentId: string, action: "approve" | "revoke") {
    setBusy(talentId);
    setError(null);
    try {
      const r = await fetch("/api/admin/rsl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ talentId, action }),
      });
      if (!r.ok) {
        const d = (await r.json()) as { error?: string };
        setError(d.error ?? "Action failed.");
        return;
      }
      await load();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>;
  if (items.length === 0) {
    return <p className="text-sm" style={{ color: "var(--color-muted)" }}>No talent have opted in to publish a consent profile yet.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs" style={{ color: "var(--color-accent)" }}>{error}</p>}
      {items.map((it) => {
        const l = LIGHT[it.overall];
        return (
          <div
            key={it.talentId}
            className="rounded border p-4 flex items-start gap-4"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{it.name}</span>
                <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: l.colour }}>
                  <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: l.dot }} />
                  {l.label}
                </span>
                {it.live && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: "rgba(22,101,52,0.1)", color: "#166534" }}>live</span>
                )}
                {it.vaultLocked && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: "rgba(153,27,27,0.1)", color: "#991b1b" }}>vault locked</span>
                )}
              </div>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                {it.email}{it.profession ? ` · ${it.profession}` : ""}
              </p>
              {it.publicUrl && (
                <a href={it.publicUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline mt-1 inline-block" style={{ color: "var(--color-accent)" }}>
                  {it.publicUrl.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
            <div className="shrink-0">
              {it.adminApproved ? (
                <button
                  type="button"
                  disabled={busy === it.talentId}
                  onClick={() => act(it.talentId, "revoke")}
                  className="rounded px-3 py-1.5 text-xs font-medium"
                  style={{ border: "1px solid rgba(192,57,43,0.4)", color: "var(--color-accent)" }}
                >
                  {busy === it.talentId ? "…" : "Revoke"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy === it.talentId}
                  onClick={() => act(it.talentId, "approve")}
                  className="rounded px-3 py-1.5 text-xs font-medium text-white"
                  style={{ background: "var(--color-accent)" }}
                >
                  {busy === it.talentId ? "…" : "Approve"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
