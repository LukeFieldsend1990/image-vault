"use client";

import { useEffect, useState } from "react";

interface Rep {
  id: string;
  email: string;
  shortCode: string | null;
}

// Path C producer surface: invite a representing agent to a reserved cast slot —
// pick an existing rep on Image Vault, or fall back to a free-text email invite.
export default function InviteRepModal({
  productionId,
  castId,
  actorLabel,
  onClose,
  onDone,
}: {
  productionId: string;
  castId: string;
  actorLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const [reps, setReps] = useState<Rep[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/reps?q=${encodeURIComponent(query)}`)
        .then((r) => r.json() as Promise<{ reps?: Rep[] }>)
        .then((d) => setReps(d.reps ?? []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function invite(payload: { repUserId?: string; email?: string }) {
    setSubmitting(true);
    setError("");
    try {
      const r = await fetch(`/api/productions/${productionId}/cast/${castId}/invite-rep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) { setError(d.error ?? "Couldn't send the invite."); return; }
      onDone();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const looksLikeEmail = query.includes("@") && query.includes(".");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rounded-lg shadow-xl w-full max-w-md p-6" style={{ background: "var(--color-bg)" }}>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--color-ink)" }}>Invite representation</h2>
        <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
          Ask {actorLabel}&apos;s agent to confirm their email and connect them to this role.
        </p>

        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agents by code (AG-####) or email…"
          className="w-full mb-3"
          style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "8px 12px", fontSize: 14, color: "var(--color-text)", outline: "none" }}
        />

        {reps.length > 0 && (
          <div className="rounded overflow-hidden mb-3 divide-y" style={{ border: "1px solid var(--color-border)" }}>
            {reps.map((rep) => (
              <button
                key={rep.id}
                type="button"
                disabled={submitting}
                onClick={() => invite({ repUserId: rep.id })}
                className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 flex items-center justify-between"
                style={{ color: "var(--color-text)", background: "var(--color-surface)" }}
              >
                <span>{rep.email}</span>
                {rep.shortCode && <span className="text-xs" style={{ color: "var(--color-muted)" }}>{rep.shortCode}</span>}
              </button>
            ))}
          </div>
        )}

        {looksLikeEmail && (
          <button
            type="button"
            disabled={submitting}
            onClick={() => invite({ email: query.trim() })}
            className="w-full rounded px-4 py-2 text-sm font-medium text-white mb-3"
            style={{ background: "var(--color-accent)", opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? "Inviting…" : `Invite ${query.trim()} by email`}
          </button>
        )}

        {error && <p className="text-xs mb-3" style={{ color: "var(--color-accent)" }}>{error}</p>}

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium rounded" style={{ color: "var(--color-ink)", border: "1px solid var(--color-border)" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
