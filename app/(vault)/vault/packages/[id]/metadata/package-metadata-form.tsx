"use client";

import { useState } from "react";

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

  const labelClass = "block text-xs font-medium mb-1.5";
  const inputClass = "w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 transition";
  const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" };

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
