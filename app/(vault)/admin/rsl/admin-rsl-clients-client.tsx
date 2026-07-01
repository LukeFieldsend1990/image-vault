"use client";

import { useEffect, useState } from "react";

interface Client {
  id: string;
  clientName: string | null;
  contactEmail: string | null;
  verified: boolean;
  blockedAt: number | null;
  activeSources: number;
}

export default function AdminRslClientsClient() {
  const [items, setItems] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/admin/rsl/clients");
      const d = (await r.json()) as { items?: Client[]; error?: string };
      if (!r.ok) { setError(d.error ?? "Could not load."); return; }
      setItems(d.items ?? []);
    } catch { setError("Network error."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function act(clientId: string, action: "block" | "unblock" | "verify") {
    setBusy(clientId); setError(null);
    try {
      const r = await fetch("/api/admin/rsl/clients", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, action }),
      });
      if (!r.ok) { const d = (await r.json()) as { error?: string }; setError(d.error ?? "Failed."); return; }
      await load();
    } catch { setError("Network error."); }
    finally { setBusy(null); }
  }

  if (loading) return <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>;
  if (items.length === 0) return <p className="text-sm" style={{ color: "var(--color-muted)" }}>No AI clients yet.</p>;

  return (
    <div className="space-y-2">
      {error && <p className="text-xs" style={{ color: "var(--color-accent)" }}>{error}</p>}
      {items.map((c) => {
        const blocked = !!c.blockedAt;
        return (
          <div key={c.id} className="rounded border p-3 flex items-center gap-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{c.clientName || "AI client"}</span>
                {c.verified && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: "rgba(22,101,52,0.1)", color: "#166534" }}>verified</span>}
                {blocked && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: "rgba(153,27,27,0.1)", color: "#991b1b" }}>blocked</span>}
                {c.activeSources > 0 && <span className="text-[10px]" style={{ color: "var(--color-muted)" }}>{c.activeSources} active key{c.activeSources > 1 ? "s" : ""}</span>}
              </div>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{c.contactEmail || "—"}</p>
            </div>
            <div className="shrink-0 flex gap-1.5">
              {!c.verified && (
                <button type="button" disabled={busy === c.id} onClick={() => act(c.id, "verify")} className="rounded px-2.5 py-1 text-xs font-medium" style={{ border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>Verify</button>
              )}
              {blocked ? (
                <button type="button" disabled={busy === c.id} onClick={() => act(c.id, "unblock")} className="rounded px-2.5 py-1 text-xs font-medium" style={{ border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>Unblock</button>
              ) : (
                <button type="button" disabled={busy === c.id} onClick={() => act(c.id, "block")} className="rounded px-2.5 py-1 text-xs font-medium" style={{ border: "1px solid rgba(192,57,43,0.4)", color: "var(--color-accent)" }}>Block</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
