"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewCompanyButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass = "w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 transition";
  const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" };

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/production-companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), website: website.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Failed to create");
      }
      setName("");
      setWebsite("");
      setOpen(false);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded border transition"
        style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
      >
        + New Company
      </button>
    );
  }

  return (
    <div className="rounded border p-4 mt-3 space-y-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>New Production Company</p>
      <div className="grid grid-cols-2 gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Company name"
          className={inputClass}
          style={inputStyle}
          autoFocus
        />
        <input
          type="text"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="Website (optional)"
          className={inputClass}
          style={inputStyle}
        />
      </div>
      {error && <p className="text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={handleCreate}
          disabled={saving || !name.trim()}
          className="rounded px-4 py-2 text-sm font-medium text-white transition disabled:opacity-60"
          style={{ background: "var(--color-accent)" }}
        >
          {saving ? "Creating…" : "Create"}
        </button>
        <button
          onClick={() => { setOpen(false); setName(""); setWebsite(""); setError(null); }}
          className="rounded px-4 py-2 text-sm transition"
          style={{ color: "var(--color-muted)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
