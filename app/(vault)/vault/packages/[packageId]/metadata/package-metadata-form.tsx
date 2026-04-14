"use client";

import { useState, useEffect, useCallback } from "react";

const SCAN_TYPES = [
  { value: "", label: "Not set" },
  { value: "light_stage", label: "Light Stage" },
  { value: "photogrammetry", label: "Photogrammetry" },
  { value: "lidar", label: "LiDAR" },
  { value: "structured_light", label: "Structured Light" },
  { value: "other", label: "Other" },
];

const ENGINE_OPTIONS = ["Unreal", "Unity", "Maya", "Blender", "Houdini", "Cinema 4D", "3ds Max"];

const TAG_OPTIONS = ["Full Body", "Face Only", "Hands", "Dental", "Hair", "Clothing", "Props", "Reference Only"];

interface PackageMetadata {
  id: string;
  name: string;
  scanType: string | null;
  resolution: string | null;
  polygonCount: number | null;
  colorSpace: string | null;
  hasMesh: boolean;
  hasTexture: boolean;
  hasHdr: boolean;
  hasMotionCapture: boolean;
  compatibleEngines: string | null; // JSON string
  tags: string | null; // JSON string
  internalNotes: string | null;
}

export default function PackageMetadataForm({ metadata }: { metadata: PackageMetadata }) {
  const [scanType, setScanType] = useState(metadata.scanType ?? "");
  const [resolution, setResolution] = useState(metadata.resolution ?? "");
  const [polygonCount, setPolygonCount] = useState(metadata.polygonCount?.toString() ?? "");
  const [colorSpace, setColorSpace] = useState(metadata.colorSpace ?? "");
  const [hasMesh, setHasMesh] = useState(metadata.hasMesh);
  const [hasTexture, setHasTexture] = useState(metadata.hasTexture);
  const [hasHdr, setHasHdr] = useState(metadata.hasHdr);
  const [hasMotionCapture, setHasMotionCapture] = useState(metadata.hasMotionCapture);
  const [engines, setEngines] = useState<string[]>(() => {
    try { return metadata.compatibleEngines ? JSON.parse(metadata.compatibleEngines) : []; }
    catch { return []; }
  });
  const [tags, setTags] = useState<string[]>(() => {
    try { return metadata.tags ? JSON.parse(metadata.tags) : []; }
    catch { return []; }
  });
  const [internalNotes, setInternalNotes] = useState(metadata.internalNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleEngine(engine: string) {
    setEngines((prev) => prev.includes(engine) ? prev.filter((e) => e !== engine) : [...prev, engine]);
  }

  function toggleTag(tag: string) {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(`/api/vault/packages/${metadata.id}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanType: scanType || null,
          resolution: resolution.trim() || null,
          polygonCount: polygonCount ? parseInt(polygonCount) : null,
          colorSpace: colorSpace.trim() || null,
          hasMesh,
          hasTexture,
          hasHdr,
          hasMotionCapture,
          compatibleEngines: engines,
          tags,
          internalNotes: internalNotes.trim() || null,
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

  const labelClass = "block text-xs font-medium mb-1.5";
  const inputClass = "w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 transition";
  const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" };

  return (
    <div className="space-y-6">
      {/* Scan Details */}
      <div>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>Scan Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} style={{ color: "var(--color-text)" }}>Scan Type</label>
            <select value={scanType} onChange={(e) => setScanType(e.target.value)} className={inputClass} style={{ ...inputStyle, appearance: "auto" }}>
              {SCAN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} style={{ color: "var(--color-text)" }}>Resolution</label>
            <input type="text" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="e.g. 8K, 4K" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className={labelClass} style={{ color: "var(--color-text)" }}>Polygon Count</label>
            <input type="number" value={polygonCount} onChange={(e) => setPolygonCount(e.target.value)} placeholder="e.g. 5000000" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className={labelClass} style={{ color: "var(--color-text)" }}>Colour Space</label>
            <input type="text" value={colorSpace} onChange={(e) => setColorSpace(e.target.value)} placeholder="e.g. ACES, sRGB" className={inputClass} style={inputStyle} />
          </div>
        </div>
      </div>

      {/* Capabilities */}
      <div>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>Capabilities</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "3D Mesh", value: hasMesh, set: setHasMesh },
            { label: "Textures", value: hasTexture, set: setHasTexture },
            { label: "HDR Lighting Data", value: hasHdr, set: setHasHdr },
            { label: "Motion Capture", value: hasMotionCapture, set: setHasMotionCapture },
          ].map((cap) => (
            <label
              key={cap.label}
              className="flex items-center gap-3 rounded border px-3 py-2.5 cursor-pointer transition"
              style={{
                borderColor: cap.value ? "var(--color-accent)" : "var(--color-border)",
                background: cap.value ? "var(--color-surface)" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={cap.value}
                onChange={(e) => cap.set(e.target.checked)}
                className="h-4 w-4 rounded"
                style={{ accentColor: "var(--color-accent)" }}
              />
              <span className="text-sm" style={{ color: "var(--color-text)" }}>{cap.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Compatible Engines */}
      <div>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>Compatible Engines</h2>
        <div className="flex flex-wrap gap-2">
          {ENGINE_OPTIONS.map((engine) => {
            const active = engines.includes(engine);
            return (
              <button
                key={engine}
                type="button"
                onClick={() => toggleEngine(engine)}
                className="rounded-full border px-3 py-1.5 text-xs font-medium transition"
                style={{
                  borderColor: active ? "var(--color-accent)" : "var(--color-border)",
                  background: active ? "var(--color-accent)" : "transparent",
                  color: active ? "#fff" : "var(--color-text)",
                }}
              >
                {engine}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tags */}
      <div>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>Tags</h2>
        <div className="flex flex-wrap gap-2">
          {TAG_OPTIONS.map((tag) => {
            const active = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className="rounded-full border px-3 py-1.5 text-xs font-medium transition"
                style={{
                  borderColor: active ? "var(--color-accent)" : "var(--color-border)",
                  background: active ? "var(--color-accent)" : "transparent",
                  color: active ? "#fff" : "var(--color-text)",
                }}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      {/* AI & Custom Tags */}
      <TagEditor packageId={metadata.id} />

      {/* Internal Notes */}
      <div>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>Internal Notes</h2>
        <p className="text-xs mb-2" style={{ color: "var(--color-muted)" }}>Not visible to licensees.</p>
        <textarea
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          rows={3}
          className={inputClass}
          style={{ ...inputStyle, resize: "vertical" }}
          placeholder="Technical notes, calibration details, known issues…"
        />
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded px-5 py-2.5 text-sm font-medium text-white transition disabled:opacity-60"
          style={{ background: "var(--color-accent)" }}
        >
          {saving ? "Saving…" : "Save Metadata"}
        </button>
        {saved && <span className="text-xs font-medium" style={{ color: "#059669" }}>Saved</span>}
        {error && <span className="text-xs" style={{ color: "var(--color-danger)" }}>{error}</span>}
      </div>
    </div>
  );
}

// ── Tag Editor (AI + custom tags) ──────────────────────────────────────────

interface StructuredTag {
  id: string;
  tag: string;
  category: string;
  status: string;
  suggestedBy: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  scan_type: "#6366f1",
  quality: "#059669",
  compatibility: "#d97706",
  completeness: "#8b5cf6",
  lighting: "#eab308",
  angle: "#06b6d4",
  background: "#64748b",
  body_region: "#ec4899",
};

function TagEditor({ packageId }: { packageId: string }) {
  const [tags, setTags] = useState<StructuredTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCategory, setNewCategory] = useState("");
  const [newTag, setNewTag] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/package-tags/${packageId}`);
      if (res.ok) {
        const data = await res.json() as { tags: StructuredTag[] };
        setTags(data.tags);
      }
    } finally {
      setLoading(false);
    }
  }, [packageId]);

  useEffect(() => { void fetchTags(); }, [fetchTags]);

  async function handleAdd() {
    if (!newCategory.trim() || !newTag.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/ai/package-tags/${packageId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: newCategory.trim(), tag: newTag.trim() }),
      });
      if (res.ok) {
        setNewCategory("");
        setNewTag("");
        await fetchTags();
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(tagId: string) {
    setDeletingId(tagId);
    try {
      await fetch(`/api/ai/package-tags/${tagId}`, { method: "DELETE" });
      setTags((prev) => prev.filter((t) => t.id !== tagId));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAccept(tagId: string) {
    await fetch(`/api/ai/package-tags/${tagId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "accepted" }),
    });
    setTags((prev) => prev.map((t) => t.id === tagId ? { ...t, status: "accepted" } : t));
  }

  async function handleDismiss(tagId: string) {
    await fetch(`/api/ai/package-tags/${tagId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "dismissed" }),
    });
    setTags((prev) => prev.map((t) => t.id === tagId ? { ...t, status: "dismissed" } : t));
  }

  // Group tags by category
  const grouped = new Map<string, StructuredTag[]>();
  for (const t of tags) {
    const arr = grouped.get(t.category) ?? [];
    arr.push(t);
    grouped.set(t.category, arr);
  }

  return (
    <div>
      <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink)" }}>AI &amp; Custom Tags</h2>
      <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
        AI-suggested tags appear automatically. Add your own as category / tag pairs.
      </p>

      {loading ? (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading tags…</p>
      ) : (
        <>
          {/* Existing tags grouped by category */}
          {grouped.size > 0 && (
            <div className="space-y-2 mb-4">
              {[...grouped.entries()].map(([category, catTags]) => (
                <div key={category}>
                  <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: CATEGORY_COLORS[category] ?? "var(--color-muted)" }}>
                    {category.replace(/_/g, " ")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {catTags.map((t) => (
                      <span
                        key={t.id}
                        className="inline-flex items-center gap-1 text-[11px] pl-2 pr-1 py-0.5 rounded-sm group"
                        style={{
                          background: "var(--color-surface)",
                          border: `1px solid ${t.status === "dismissed" ? "var(--color-border)" : (CATEGORY_COLORS[category] ?? "var(--color-border)")}`,
                          color: t.status === "dismissed" ? "var(--color-muted)" : "var(--color-text)",
                          opacity: t.status === "dismissed" ? 0.5 : 1,
                          textDecoration: t.status === "dismissed" ? "line-through" : "none",
                        }}
                      >
                        {t.tag.replace(/-/g, " ")}
                        {t.suggestedBy === "ai" && t.status === "suggested" && (
                          <>
                            <button
                              onClick={() => handleAccept(t.id)}
                              className="ml-0.5 p-0.5 rounded transition hover:bg-green-100"
                              title="Accept"
                              style={{ color: "#059669" }}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            </button>
                            <button
                              onClick={() => handleDismiss(t.id)}
                              className="p-0.5 rounded transition hover:bg-red-100"
                              title="Dismiss"
                              style={{ color: "#dc2626" }}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDelete(t.id)}
                          disabled={deletingId === t.id}
                          className="p-0.5 rounded opacity-0 group-hover:opacity-60 transition hover:!opacity-100"
                          title="Remove"
                          style={{ color: "var(--color-muted)" }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tags.length === 0 && (
            <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>No tags yet.</p>
          )}

          {/* Add custom tag */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--color-text)" }}>Category</label>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="e.g. lighting"
                className="w-full rounded border px-2.5 py-1.5 text-xs outline-none focus:ring-1 transition"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAdd(); } }}
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--color-text)" }}>Tag</label>
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="e.g. studio-neutral"
                className="w-full rounded border px-2.5 py-1.5 text-xs outline-none focus:ring-1 transition"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAdd(); } }}
              />
            </div>
            <button
              type="button"
              onClick={handleAdd}
              disabled={adding || !newCategory.trim() || !newTag.trim()}
              className="shrink-0 rounded border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
            >
              {adding ? "…" : "Add"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
