"use client";

import { useState } from "react";

const TYPE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "film", label: "Film" },
  { value: "tv_series", label: "TV Series" },
  { value: "tv_movie", label: "TV Movie" },
  { value: "commercial", label: "Commercial" },
  { value: "game", label: "Game" },
  { value: "music_video", label: "Music Video" },
  { value: "other", label: "Other" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "development", label: "Development" },
  { value: "pre_production", label: "Pre-production" },
  { value: "production", label: "Production" },
  { value: "post_production", label: "Post-production" },
  { value: "released", label: "Released" },
  { value: "cancelled", label: "Cancelled" },
];

interface Production {
  id: string;
  name: string;
  type: string | null;
  year: number | null;
  status: string | null;
  imdbId: string | null;
  tmdbId: number | null;
  director: string | null;
  vfxSupervisor: string | null;
  notes: string | null;
}

export default function ProductionEditForm({ production }: { production: Production }) {
  const [name, setName] = useState(production.name);
  const [type, setType] = useState(production.type ?? "");
  const [year, setYear] = useState(production.year?.toString() ?? "");
  const [status, setStatus] = useState(production.status ?? "");
  const [imdbId, setImdbId] = useState(production.imdbId ?? "");
  const [tmdbId, setTmdbId] = useState(production.tmdbId?.toString() ?? "");
  const [director, setDirector] = useState(production.director ?? "");
  const [vfxSupervisor, setVfxSupervisor] = useState(production.vfxSupervisor ?? "");
  const [notes, setNotes] = useState(production.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labelClass = "block text-xs font-medium mb-1.5";
  const inputClass = "w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 transition";
  const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" };

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(`/api/productions/${production.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type: type || null,
          year: year ? parseInt(year) : null,
          status: status || null,
          imdbId: imdbId.trim() || null,
          tmdbId: tmdbId ? parseInt(tmdbId) : null,
          director: director.trim() || null,
          vfxSupervisor: vfxSupervisor.trim() || null,
          notes: notes.trim() || null,
        }),
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} style={inputStyle} />
        </div>
        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>Year</label>
          <input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 2025" className={inputClass} style={inputStyle} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass} style={{ ...inputStyle, appearance: "auto" }}>
            {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass} style={{ ...inputStyle, appearance: "auto" }}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>Director</label>
          <input type="text" value={director} onChange={(e) => setDirector(e.target.value)} placeholder="e.g. Christopher Nolan" className={inputClass} style={inputStyle} />
        </div>
        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>VFX Supervisor</label>
          <input type="text" value={vfxSupervisor} onChange={(e) => setVfxSupervisor(e.target.value)} className={inputClass} style={inputStyle} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>IMDB ID</label>
          <input type="text" value={imdbId} onChange={(e) => setImdbId(e.target.value)} placeholder="e.g. tt1234567" className={inputClass} style={inputStyle} />
        </div>
        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>TMDB ID</label>
          <input type="number" value={tmdbId} onChange={(e) => setTmdbId(e.target.value)} className={inputClass} style={inputStyle} />
        </div>
      </div>

      <div>
        <label className={labelClass} style={{ color: "var(--color-text)" }}>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputClass} style={{ ...inputStyle, resize: "vertical" }} />
      </div>

      <div className="flex items-center gap-3 pt-2">
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
    </div>
  );
}
