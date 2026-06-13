"use client";

import { useState, useEffect } from "react";

// Self-serve "code view mode" toggle — decorates the UI with system codes.
export default function ShowCodesToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/show-codes")
      .then((r) => r.json() as Promise<{ enabled?: boolean }>)
      .then((d) => setEnabled(d.enabled ?? false))
      .catch(() => setError("Failed to load setting"));
  }, []);

  async function toggle() {
    if (enabled === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/show-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!res.ok) throw new Error("Failed");
      setEnabled(!enabled);
      // Reload so the layout re-reads the flag and decorations appear everywhere.
      window.location.reload();
    } catch {
      setError("Failed to save");
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm" style={{ color: "var(--color-ink)" }}>Code view mode</p>
        <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
          Show system codes (AH / PR / VX / CC, scan numbers) next to names across the app and in the chain of custody.
        </p>
      </div>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={enabled === null || loading}
        aria-pressed={enabled === true}
        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-40"
        style={{ background: enabled ? "var(--color-accent)" : "var(--color-border)" }}
      >
        <span className="inline-block h-5 w-5 rounded-full bg-white transition" style={{ transform: enabled ? "translateX(22px)" : "translateX(2px)" }} />
      </button>
      {error && <span className="text-[11px]" style={{ color: "var(--color-accent)" }}>{error}</span>}
    </div>
  );
}
