"use client";

import { useEffect, useState } from "react";

export default function RoyaltyMeterPlatformToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/settings");
      if (res.ok) {
        const d = (await res.json()) as { settings: Record<string, string> };
        // If key is absent default to true (platform on by default).
        setEnabled(d.settings["royalty_meter_enabled"] !== "false");
      }
    })();
  }, []);

  async function toggle() {
    if (enabled === null) return;
    setBusy(true);
    setError(null);
    try {
      const next = !enabled;
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "royalty_meter_enabled", value: next ? "true" : "false" }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Failed");
      }
      setEnabled(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded border px-4 py-3.5 flex items-center justify-between gap-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Live Royalty Meter</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
          Platform-wide toggle. When off, the /royalties page is hidden and no usage events are accepted.
        </p>
        {error && <p className="text-[11px] mt-1" style={{ color: "var(--color-danger)" }}>{error}</p>}
      </div>
      <button
        onClick={toggle}
        disabled={busy || enabled === null}
        className="shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded border transition disabled:opacity-40 whitespace-nowrap"
        style={enabled
          ? { borderColor: "rgba(192,57,43,0.3)", color: "#c0392b", background: "rgba(192,57,43,0.06)" }
          : { borderColor: "rgba(107,114,128,0.3)", color: "#6b7280", background: "rgba(107,114,128,0.06)" }
        }
      >
        {enabled === null ? "…" : busy ? "…" : enabled ? "Platform On — click to disable" : "Platform Off — click to enable"}
      </button>
    </div>
  );
}
