"use client";

import { useState, useEffect } from "react";

export default function PitchVignettesToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/pitch-vignettes")
      .then((r) => r.json() as Promise<{ enabled?: boolean }>)
      .then((data) => setEnabled(data.enabled ?? false))
      .catch(() => setError("Failed to load setting"));
  }, []);

  async function toggle() {
    if (enabled === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/pitch-vignettes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Failed");
      }
      setEnabled(!enabled);
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
            {enabled === null ? "Loading…" : enabled ? "AI pitches enabled" : "AI pitches disabled"}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
            {enabled
              ? "Your representatives can generate short AI video pitches from your scan packages to present you for specific roles."
              : "Representatives cannot generate AI pitch vignettes from your scan data. Enable to allow this."}
          </p>
        </div>

        <button
          onClick={toggle}
          disabled={loading || enabled === null}
          className="ml-4 shrink-0 flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded border transition disabled:opacity-50"
          style={enabled
            ? { borderColor: "var(--color-accent)", color: "var(--color-accent)", background: "rgba(192,57,43,0.06)" }
            : { borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-surface)" }
          }
        >
          {loading ? (
            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : null}
          {enabled ? "Disable" : "Enable"}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>
      )}
    </div>
  );
}
