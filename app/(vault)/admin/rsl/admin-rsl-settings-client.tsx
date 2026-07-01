"use client";

import { useEffect, useState } from "react";

interface Settings { olpEnabled: boolean; autoAcceptEnabled: boolean; }

export default function AdminRslSettingsClient() {
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/rsl/settings");
        const d = (await r.json()) as Settings & { error?: string };
        if (!r.ok) { setError(d.error ?? "Could not load."); return; }
        setS({ olpEnabled: d.olpEnabled, autoAcceptEnabled: d.autoAcceptEnabled });
      } catch { setError("Network error."); }
    })();
  }, []);

  async function toggle(patch: Partial<Settings>) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/admin/rsl/settings", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const d = (await r.json()) as Settings & { error?: string };
      if (!r.ok) { setError(d.error ?? "Could not save."); return; }
      setS({ olpEnabled: d.olpEnabled, autoAcceptEnabled: d.autoAcceptEnabled });
    } catch { setError("Network error."); }
    finally { setBusy(false); }
  }

  if (!s) return <p className="text-sm" style={{ color: "var(--color-muted)" }}>{error ?? "Loading…"}</p>;

  const Row = ({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) => (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span className="text-sm" style={{ color: "var(--color-text)" }}>
        {label}
        <span className="block text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="rounded border p-4 space-y-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <Row label="OLP licensing enabled" hint="Master switch. Off = the token endpoint stops issuing/creating licences platform-wide." on={s.olpEnabled} onChange={(v) => toggle({ olpEnabled: v })} />
      <Row label="Auto-license enabled" hint="Off = even talent with an auto-accept rate card route to manual approval." on={s.autoAcceptEnabled} onChange={(v) => toggle({ autoAcceptEnabled: v })} />
      {error && <p className="text-xs" style={{ color: "var(--color-accent)" }}>{error}</p>}
    </div>
  );
}
