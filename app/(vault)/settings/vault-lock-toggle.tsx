"use client";

import { useState, useEffect } from "react";

export default function VaultLockToggle() {
  const [locked, setLocked] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/vault-lock")
      .then((r) => r.json() as Promise<{ locked?: boolean }>)
      .then((data) => setLocked(data.locked ?? false))
      .catch(() => setError("Failed to load vault lock state"));
  }, []);

  async function toggle() {
    if (locked === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/vault-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: !locked }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Failed");
      }
      setLocked(!locked);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {locked === null ? "Loading…" : locked ? "Vault is locked" : "Vault is unlocked"}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
            {locked
              ? "No new licence requests or downloads can be initiated while the vault is locked."
              : "Your vault is accepting licence requests and download sessions normally."}
          </p>
        </div>

        <button
          onClick={toggle}
          disabled={loading || locked === null}
          className="ml-4 shrink-0 flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded border transition disabled:opacity-50"
          style={locked
            ? { borderColor: "var(--color-accent)", color: "var(--color-accent)", background: "rgba(192,57,43,0.06)" }
            : { borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-surface)" }
          }
        >
          {loading ? (
            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : locked ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
          )}
          {locked ? "Unlock vault" : "Lock vault"}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>
      )}

      {locked && (
        <div
          className="mt-3 flex items-start gap-2 rounded p-2.5 text-xs"
          style={{ background: "rgba(192,57,43,0.06)", border: "1px solid rgba(192,57,43,0.2)", color: "var(--color-accent)" }}
        >
          <svg width="12" height="12" className="mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Vault is locked. All outbound licence requests and download sessions are blocked until unlocked.
        </div>
      )}
    </div>
  );
}
