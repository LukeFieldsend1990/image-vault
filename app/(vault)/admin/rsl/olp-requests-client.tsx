"use client";

import { useEffect, useState } from "react";

interface ReqItem {
  id: string;
  talentId: string;
  email: string;
  fullName: string | null;
  usage: string;
  useCategoryId: string;
  postureLight: "amber" | "green";
  clientName: string | null;
  clientId: string | null;
  contactEmail: string | null;
  intendedUse: string | null;
  status: "pending_review" | "granted" | "denied" | "expired";
  createdAt: number;
}

const STATUS_STYLE: Record<ReqItem["status"], { label: string; bg: string; colour: string }> = {
  pending_review: { label: "Pending", bg: "rgba(180,83,9,0.1)", colour: "#b45309" },
  granted: { label: "Granted", bg: "rgba(22,101,52,0.1)", colour: "#166534" },
  denied: { label: "Denied", bg: "rgba(153,27,27,0.1)", colour: "#991b1b" },
  expired: { label: "Expired", bg: "var(--color-border)", colour: "var(--color-muted)" },
};

export default function OlpRequestsClient() {
  const [items, setItems] = useState<ReqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/rsl/requests");
      const d = (await r.json()) as { items?: ReqItem[]; error?: string };
      if (!r.ok) { setError(d.error ?? "Could not load."); return; }
      setItems(d.items ?? []);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function decide(id: string, action: "grant" | "deny") {
    setBusy(id);
    setError(null);
    try {
      const r = await fetch(`/api/rsl/requests/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
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
    return <p className="text-sm" style={{ color: "var(--color-muted)" }}>No OLP licence requests yet.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs" style={{ color: "var(--color-accent)" }}>{error}</p>}
      {items.map((it) => {
        const s = STATUS_STYLE[it.status];
        return (
          <div
            key={it.id}
            className="rounded border p-4 flex items-start gap-4"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                  {it.clientName || it.clientId || "Unidentified client"}
                </span>
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--color-bg)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                  {it.usage}
                </span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: s.bg, color: s.colour }}>{s.label}</span>
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
                For <span style={{ color: "var(--color-text)" }}>{it.fullName || it.email}</span>
                {it.contactEmail ? ` · contact ${it.contactEmail}` : ""}
              </p>
              {it.intendedUse && (
                <p className="text-xs mt-1 italic" style={{ color: "var(--color-muted)" }}>&ldquo;{it.intendedUse}&rdquo;</p>
              )}
            </div>
            {it.status === "pending_review" && (
              <div className="shrink-0 flex gap-2">
                <button
                  type="button"
                  disabled={busy === it.id}
                  onClick={() => decide(it.id, "grant")}
                  className="rounded px-3 py-1.5 text-xs font-medium text-white"
                  style={{ background: "var(--color-accent)" }}
                >
                  {busy === it.id ? "…" : "Grant"}
                </button>
                <button
                  type="button"
                  disabled={busy === it.id}
                  onClick={() => decide(it.id, "deny")}
                  className="rounded px-3 py-1.5 text-xs font-medium"
                  style={{ border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
                >
                  Deny
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
