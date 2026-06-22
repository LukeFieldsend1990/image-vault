"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ORG_TYPES, ORG_TYPE_LABELS } from "@/lib/organisations/orgTypes";

export default function NewOrganisationButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [orgType, setOrgType] = useState("production_company");
  const [website, setWebsite] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass = "w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 transition";
  const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" };

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/organisations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          orgType,
          website: website.trim() || null,
          billingEmail: billingEmail.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to create");
      }
      const data = (await res.json()) as { id: string };
      setName("");
      setWebsite("");
      setBillingEmail("");
      setOrgType("production_company");
      setOpen(false);
      router.push(`/admin/organisations/${data.id}`);
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
        className="shrink-0 flex items-center gap-2 rounded px-4 py-2 text-sm font-medium text-white"
        style={{ background: "var(--color-accent)" }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New Organisation
      </button>
    );
  }

  return (
    <div className="rounded border p-4 mb-6 space-y-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>New Organisation</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Organisation name"
          className={inputClass}
          style={inputStyle}
          autoFocus
        />
        <select
          value={orgType}
          onChange={(e) => setOrgType(e.target.value)}
          className={inputClass}
          style={inputStyle}
        >
          {ORG_TYPES.map((t) => (
            <option key={t} value={t}>{ORG_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <input
          type="text"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="Website (optional)"
          className={inputClass}
          style={inputStyle}
        />
        <input
          type="email"
          value={billingEmail}
          onChange={(e) => setBillingEmail(e.target.value)}
          placeholder="Billing email (optional)"
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
          {saving ? "Creating…" : "Create organisation"}
        </button>
        <button
          onClick={() => { setOpen(false); setName(""); setWebsite(""); setBillingEmail(""); setError(null); }}
          className="rounded px-4 py-2 text-sm transition"
          style={{ color: "var(--color-muted)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
