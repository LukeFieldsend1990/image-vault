"use client";

import { useState, useEffect } from "react";
import type { PreviewResponse } from "@/app/api/packages/[id]/preview/route";

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + " KB";
  return n + " B";
}

const CATEGORY_COLORS: Record<string, string> = {
  raw:         "#2563eb",
  exr:         "#7c3aed",
  jpeg:        "#059669",
  meta:        "#9ca3af",
  mesh:        "#d97706",
  video:       "#dc2626",
  "360viewer": "#0891b2",
  docs:        "#6b7280",
  other:       "#9ca3af",
};

function Panel({ packageId }: { packageId: string }) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/packages/${packageId}/preview`)
      .then((r) => r.ok ? r.json() as Promise<PreviewResponse> : Promise.reject())
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [packageId]);

  if (loading) return <p className="px-5 py-3 text-xs" style={{ color: "var(--color-muted)" }}>Loading preview…</p>;
  if (error || !data) return <p className="px-5 py-3 text-xs" style={{ color: "var(--color-muted)" }}>Preview unavailable.</p>;

  const maxBarBytes = Math.max(...data.stats.map((s) => s.totalBytes), 1);

  return (
    <div className="px-5 py-4 space-y-5">
      {/* JPEG grid */}
      {data.images.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
            Preview images ({data.images.length})
          </p>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
            {data.images.map((img, i) => (
              <div key={i} className="overflow-hidden rounded" style={{ aspectRatio: "3/4", background: "var(--color-border)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url} alt={img.filename} loading="lazy"
                  className="h-full w-full object-cover"
                  onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 360° video */}
      {data.mp4Url && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>360° Reference Video</p>
          {videoOpen ? (
            <video src={data.mp4Url} controls autoPlay loop className="w-full rounded" style={{ maxHeight: 200, background: "#000" }} />
          ) : (
            <button
              onClick={() => setVideoOpen(true)}
              className="flex items-center gap-2 rounded border px-3 py-2 text-xs transition"
              style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
              </svg>
              Play 360° reference video
            </button>
          )}
        </div>
      )}

      {/* File type breakdown */}
      <div>
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
          Contents — {data.totalFiles} files · {fmt(data.totalSizeBytes)}
        </p>
        <div className="space-y-2">
          {data.stats.map((s) => {
            const color = CATEGORY_COLORS[s.category] ?? "#9ca3af";
            const barPct = Math.round((s.totalBytes / maxBarBytes) * 100);
            return (
              <div key={s.category}>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                    <span className="text-xs font-medium truncate" style={{ color: "var(--color-ink)" }}>{s.label}</span>
                    <span className="text-xs shrink-0" style={{ color: "var(--color-muted)" }}>{s.count} {s.count === 1 ? "file" : "files"}</span>
                  </div>
                  <span className="text-xs shrink-0 ml-2 font-mono" style={{ color: "var(--color-muted)" }}>{fmt(s.totalBytes)}</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                  <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: color, opacity: 0.7 }} />
                </div>
                <p className="mt-0.5 text-[10px]" style={{ color: "var(--color-muted)" }}>{s.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function AdminPackagePreviewToggle({ packageId }: { packageId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ borderTop: "1px solid var(--color-border)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-2 text-[10px] font-medium uppercase tracking-widest flex items-center gap-1.5 transition hover:opacity-80"
        style={{ color: "var(--color-muted)" }}
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        {open ? "Hide preview" : "Preview scan"}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2 }}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {open && <Panel packageId={packageId} />}
    </div>
  );
}
