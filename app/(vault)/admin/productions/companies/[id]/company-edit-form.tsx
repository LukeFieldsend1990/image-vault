"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Company {
  id: string;
  name: string;
  website: string | null;
  notes: string | null;
  productionCount: number;
}

export default function CompanyEditForm({ company }: { company: Company }) {
  const router = useRouter();
  const [name, setName] = useState(company.name);
  const [website, setWebsite] = useState(company.website ?? "");
  const [notes, setNotes] = useState(company.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labelClass = "block text-xs font-medium mb-1.5";
  const inputClass = "w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 transition";
  const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" };

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/production-companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), website: website.trim() || null, notes: notes.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Failed to save");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/production-companies/${company.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Failed to delete");
      }
      router.push("/admin/productions");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} style={inputStyle} />
        </div>
        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>Website</label>
          <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="e.g. https://warnerbros.com" className={inputClass} style={inputStyle} />
        </div>
      </div>

      <div>
        <label className={labelClass} style={{ color: "var(--color-text)" }}>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputClass} style={{ ...inputStyle, resize: "vertical" }} />
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded px-5 py-2.5 text-sm font-medium text-white transition disabled:opacity-60"
            style={{ background: "var(--color-accent)" }}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          {saved && <span className="text-xs font-medium" style={{ color: "#059669" }}>Saved</span>}
          {error && <span className="text-xs" style={{ color: "var(--color-danger)" }}>{error}</span>}
        </div>

        <div className="flex items-center gap-3">
          {confirmDelete ? (
            <>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                {company.productionCount > 0
                  ? `This will unlink ${company.productionCount} production${company.productionCount !== 1 ? "s" : ""}. Sure?`
                  : "Delete this company?"}
              </span>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-3 py-1.5 rounded border transition"
                style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs px-3 py-1.5 rounded text-white transition disabled:opacity-60"
                style={{ background: "#dc2626" }}
              >
                {deleting ? "Deleting…" : "Confirm Delete"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-xs px-3 py-1.5 rounded border transition"
              style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
            >
              Delete Company
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
