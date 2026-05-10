"use client";

import { useState, useCallback } from "react";

export default function DemoToggleCard({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  const toggle = useCallback(async () => {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    try {
      await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "demo_enabled", value: String(next) }),
      });
    } catch {
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  }, [enabled]);

  return (
    <div className="rounded border" style={{ borderColor: "var(--color-border)" }}>
      <div
        className="px-5 py-3.5 border-b"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Demo Mode
        </h2>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
              Product Tour
            </p>
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--color-muted)" }}>
              Enables the public <code className="font-mono">/demo</code> route — an animated walkthrough with
              fake data for pitch presentations. Disable when not in use.
            </p>
            <p
              className="mt-2 text-[11px] font-medium"
              style={{ color: enabled ? "#166534" : "var(--color-muted)" }}
            >
              {enabled ? "● Live at /demo" : "○ Route disabled (returns 404)"}
            </p>
          </div>
          <button
            onClick={toggle}
            disabled={saving}
            style={{
              position: "relative",
              width: 40,
              height: 22,
              borderRadius: 11,
              border: "none",
              cursor: saving ? "wait" : "pointer",
              background: enabled ? "var(--color-accent)" : "var(--color-border)",
              transition: "background 0.2s",
              flexShrink: 0,
            }}
            aria-pressed={enabled}
            aria-label="Toggle demo mode"
          >
            <span
              style={{
                position: "absolute",
                top: 3,
                left: enabled ? 21 : 3,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#fff",
                transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
