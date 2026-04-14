"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import UploadModal from "../upload-modal";
import type { PreviewResponse } from "@/app/api/packages/[id]/preview/route";

interface AiTag {
  packageId: string;
  tag: string;
  category: string;
  status: string;
}

interface ScanPackage {
  id: string;
  name: string;
  description: string | null;
  captureDate: number | null;
  studioName: string | null;
  totalSizeBytes: number | null;
  status: "uploading" | "ready" | "error";
  coverImageKey: string | null;
  createdAt: number;
  fileCount: number;
  scanType: string | null;
  tags: string | null;
  hasMesh: boolean | null;
  hasTexture: boolean | null;
  hasHdr: boolean | null;
  hasMotionCapture: boolean | null;
  compatibleEngines: string | null;
  aiTags?: AiTag[];
}

interface ScanFile {
  id: string;
  filename: string;
  sizeBytes: number;
  contentType: string | null;
  uploadStatus: "pending" | "uploading" | "complete" | "error";
  createdAt: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ── Preview panel (shared with vault packages view) ──────────────────────────
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

function PackagePreviewPanel({ packageId, isOwner }: { packageId: string; isOwner: boolean }) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [settingCover, setSettingCover] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; fileKey: string; filename: string } | null>(null);

  useEffect(() => {
    fetch(`/api/packages/${packageId}/preview`)
      .then((r) => r.ok ? r.json() as Promise<PreviewResponse> : Promise.reject())
      .then((d) => { setData(d); setCoverKey(d.coverImageKey); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [packageId]);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox]);

  async function setCover(fileKey: string) {
    setSettingCover(true);
    try {
      const res = await fetch(`/api/vault/packages/${packageId}/cover`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey }),
      });
      if (res.ok) { setCoverKey(fileKey); setLightbox(null); }
    } finally {
      setSettingCover(false);
    }
  }

  if (loading) return <p className="px-5 pb-4 text-xs" style={{ color: "var(--color-muted)" }}>Loading preview…</p>;
  if (error || !data) return <p className="px-5 pb-4 text-xs" style={{ color: "var(--color-muted)" }}>Preview unavailable.</p>;

  const maxBarBytes = Math.max(...data.stats.map((s) => s.totalBytes), 1);

  return (
    <div className="border-t px-5 py-4 space-y-5" style={{ borderColor: "var(--color-border)" }}>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative flex flex-col items-center gap-4 max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full text-white transition hover:opacity-70"
              style={{ background: "rgba(255,255,255,0.15)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.url}
              alt={lightbox.filename}
              className="rounded w-full object-contain"
              style={{ maxHeight: "70vh" }}
            />

            {isOwner && (
              lightbox.fileKey === coverKey ? (
                <div
                  className="flex items-center gap-2 rounded px-4 py-2 text-sm font-medium"
                  style={{ background: "var(--color-accent)", color: "#fff" }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Current cover image
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void setCover(lightbox.fileKey)}
                  disabled={settingCover}
                  className="flex items-center gap-2 rounded border px-4 py-2 text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
                  style={{ borderColor: "#fff", color: "#fff" }}
                >
                  {settingCover ? (
                    <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  )}
                  Set as cover image
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* JPEG grid */}
      {data.images.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
            Preview images ({data.images.length})
          </p>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
            {data.images.map((img, i) => {
              const isCover = img.fileKey === coverKey;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setLightbox(img)}
                  className="relative overflow-hidden rounded cursor-pointer transition hover:opacity-90 active:scale-95"
                  style={{
                    aspectRatio: "3/4",
                    background: "var(--color-border)",
                    outline: isCover ? "2px solid var(--color-accent)" : "none",
                    outlineOffset: "1px",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url} alt={img.filename} loading="lazy"
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                  />
                  {isCover && (
                    <div
                      className="absolute bottom-0 inset-x-0 text-center text-[9px] font-bold py-0.5"
                      style={{ background: "var(--color-accent)", color: "#fff" }}
                    >
                      Cover
                    </div>
                  )}
                </button>
              );
            })}
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
          Contents — {data.totalFiles} files · {formatBytes(data.totalSizeBytes)}
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
                  <span className="text-xs shrink-0 ml-2 font-mono" style={{ color: "var(--color-muted)" }}>{formatBytes(s.totalBytes)}</span>
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

// ── Package card (handles its own expanded/file state) ───────────────────────
function PackageCard({
  pkg,
  onDelete,
  onResume,
  onAddFiles,
  deleting,
}: {
  pkg: ScanPackage;
  onDelete: (id: string) => void;
  onResume: (id: string) => void;
  onAddFiles: (id: string) => void;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [files, setFiles] = useState<ScanFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [bundleDownloading, setBundleDownloading] = useState(false);

  async function toggleExpand() {
    if (!expanded && files.length === 0) {
      setFilesLoading(true);
      try {
        const res = await fetch(`/api/vault/packages/${pkg.id}`);
        if (res.ok) {
          const data = await res.json() as { files: ScanFile[] };
          setFiles(data.files);
        }
      } finally {
        setFilesLoading(false);
      }
    }
    setExpanded((v) => !v);
  }

  async function handleBundleDownload() {
    setBundleDownloading(true);
    try {
      const name = encodeURIComponent(`${pkg.name}.zip`);
      const res = await fetch(`/api/vault/packages/${pkg.id}/bundle?name=${name}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${pkg.name}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBundleDownloading(false);
    }
  }

  async function handleDownload(file: ScanFile) {
    setDownloadingId(file.id);
    try {
      const res = await fetch(`/api/vault/files/${file.id}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDeleteFile(fileId: string) {
    setDeletingFileId(fileId);
    try {
      const res = await fetch(`/api/vault/files/${fileId}`, { method: "DELETE" });
      if (res.ok) {
        setFiles((prev) => prev.filter((f) => f.id !== fileId));
      }
    } finally {
      setDeletingFileId(null);
    }
  }

  return (
    <div
      className="border rounded-sm overflow-hidden"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      {/* ── Header row ── */}
      <div className="px-4 sm:px-5 py-4">
        <div className="flex items-center gap-3 sm:gap-4">
        {/* Expand toggle */}
        <button
          onClick={toggleExpand}
          className="shrink-0 p-1 rounded transition opacity-40 hover:opacity-100"
          style={{ color: "var(--color-ink)" }}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <svg
            width="12" height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* Cover thumbnail */}
        {pkg.coverImageKey && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/vault/packages/${pkg.id}/cover`}
            alt="Cover"
            className="shrink-0 rounded object-cover"
            style={{ width: 88, height: 116, background: "var(--color-border)" }}
          />
        )}

        {/* Meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <p className="text-sm font-medium text-[--color-ink] truncate">{pkg.name}</p>
            {pkg.status === "uploading" ? (
              <>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-700">
                  <svg className="animate-spin" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Uploading
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onResume(pkg.id); }}
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm transition hover:opacity-70"
                  style={{ background: "rgba(192,57,43,0.1)", color: "var(--color-accent)" }}
                  title="Resume upload"
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Resume
                </button>
              </>
            ) : pkg.status === "ready" ? (
              <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-green-100 text-green-700">
                Ready
              </span>
            ) : (
              <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-red-100 text-red-700">
                Error
              </span>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-3 text-[11px]" style={{ color: "var(--color-muted)" }}>
            {pkg.studioName && <span>{pkg.studioName}</span>}
            {pkg.captureDate && (
              <>
                {pkg.studioName && <span>·</span>}
                <span>{formatDate(pkg.captureDate)}</span>
              </>
            )}
          </div>
          {/* Metadata chips */}
          {(() => {
            const tags: string[] = (() => { try { return pkg.tags ? JSON.parse(pkg.tags) as string[] : []; } catch { return []; } })();
            const caps: string[] = [
              pkg.hasMesh && "Mesh",
              pkg.hasTexture && "Textures",
              pkg.hasHdr && "HDR",
              pkg.hasMotionCapture && "MoCap",
            ].filter(Boolean) as string[];
            const scanTypeLabel: Record<string, string> = {
              light_stage: "Light Stage", photogrammetry: "Photogrammetry",
              lidar: "LiDAR", structured_light: "Structured Light", other: "Other",
            };
            const hasAny = pkg.scanType || caps.length > 0 || tags.length > 0 || (pkg.aiTags ?? []).length > 0;
            if (!hasAny) return null;
            return (
              <div className="hidden sm:flex flex-wrap items-center gap-1.5 mt-1.5">
                {pkg.scanType && (
                  <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-sm"
                    style={{ background: "var(--color-accent)", color: "#fff", opacity: 0.85 }}>
                    {scanTypeLabel[pkg.scanType] ?? pkg.scanType}
                  </span>
                )}
                {caps.map((cap) => (
                  <span key={cap} className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-sm"
                    style={{ background: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                    {cap}
                  </span>
                ))}
                {tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-sm"
                    style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                    {tag}
                  </span>
                ))}
                {(pkg.aiTags ?? []).map((at) => (
                  <span key={`${at.category}:${at.tag}`} className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-sm"
                    style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)", opacity: at.status === "suggested" ? 0.7 : 1 }}>
                    {at.tag.replace(/-/g, " ")}
                  </span>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Right side: file count + size + actions (desktop) */}
        <div className="hidden sm:flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-xs font-medium text-[--color-ink]">
              {pkg.fileCount} file{pkg.fileCount !== 1 ? "s" : ""}
            </p>
            {pkg.totalSizeBytes != null && pkg.totalSizeBytes > 0 && (
              <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                {formatBytes(pkg.totalSizeBytes)}
              </p>
            )}
          </div>
          {pkg.status === "ready" && (
            <button
              onClick={() => setPreviewOpen((v) => !v)}
              className="flex items-center gap-1 p-1.5 rounded transition opacity-40 hover:opacity-100"
              style={{ color: "var(--color-ink)" }}
              title="Preview scan"
              aria-label="Preview scan"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
          <button
            onClick={() => onAddFiles(pkg.id)}
            className="p-1.5 rounded transition opacity-40 hover:opacity-100"
            style={{ color: "var(--color-ink)" }}
            title="Add files to package"
            aria-label="Add files to package"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <Link
            href={`/vault/packages/${pkg.id}/chain-of-custody`}
            className="p-1.5 rounded transition opacity-40 hover:opacity-100"
            style={{ color: "var(--color-ink)" }}
            title="Chain of custody"
            aria-label="View chain of custody"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </Link>
          <Link
            href={`/vault/packages/${pkg.id}/metadata`}
            className="p-1.5 rounded transition opacity-40 hover:opacity-100"
            style={{ color: "var(--color-ink)" }}
            title="Edit metadata"
            aria-label="Edit package metadata"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="14" y2="12" />
              <line x1="4" y1="18" x2="10" y2="18" />
              <polyline points="16 16 19 19 22 16" />
              <line x1="19" y1="10" x2="19" y2="19" />
            </svg>
          </Link>
          <button
            onClick={() => onDelete(pkg.id)}
            disabled={deleting}
            className="p-1.5 rounded transition opacity-40 hover:opacity-100 disabled:opacity-20"
            style={{ color: "var(--color-ink)" }}
            title="Delete package"
            aria-label="Delete package"
          >
            {deleting ? (
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4h6v2" />
              </svg>
            )}
          </button>
        </div>
        </div>
        {/* Mobile: file count + action icons on second row */}
        <div className="flex sm:hidden items-center justify-between mt-2 pl-8">
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            {pkg.fileCount} file{pkg.fileCount !== 1 ? "s" : ""}
            {pkg.totalSizeBytes != null && pkg.totalSizeBytes > 0 && ` · ${formatBytes(pkg.totalSizeBytes)}`}
          </p>
          <div className="flex items-center gap-1">
            {pkg.status === "ready" && (
              <button
                onClick={() => setPreviewOpen((v) => !v)}
                className="p-1.5 rounded transition opacity-40 hover:opacity-100"
                style={{ color: "var(--color-ink)" }}
                title="Preview scan"
                aria-label="Preview scan"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            )}
            <button
              onClick={() => onAddFiles(pkg.id)}
              className="p-1.5 rounded transition opacity-40 hover:opacity-100"
              style={{ color: "var(--color-ink)" }}
              title="Add files to package"
              aria-label="Add files to package"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <Link
              href={`/vault/packages/${pkg.id}/chain-of-custody`}
              className="p-1.5 rounded transition opacity-40 hover:opacity-100"
              style={{ color: "var(--color-ink)" }}
              title="Chain of custody"
              aria-label="View chain of custody"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </Link>
            <Link
              href={`/vault/packages/${pkg.id}/metadata`}
              className="p-1.5 rounded transition opacity-40 hover:opacity-100"
              style={{ color: "var(--color-ink)" }}
              title="Edit metadata"
              aria-label="Edit package metadata"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="14" y2="12" />
                <line x1="4" y1="18" x2="10" y2="18" />
                <polyline points="16 16 19 19 22 16" />
                <line x1="19" y1="10" x2="19" y2="19" />
              </svg>
            </Link>
            <button
              onClick={() => onDelete(pkg.id)}
              disabled={deleting}
              className="p-1.5 rounded transition opacity-40 hover:opacity-100 disabled:opacity-20"
              style={{ color: "var(--color-ink)" }}
              title="Delete package"
              aria-label="Delete package"
            >
              {deleting ? (
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Preview panel ── */}
      {previewOpen && <PackagePreviewPanel packageId={pkg.id} isOwner />}

      {/* ── Expanded file list ── */}
      {expanded && (
        <div
          className="border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          {filesLoading ? (
            <p className="px-14 py-3 text-xs" style={{ color: "var(--color-muted)" }}>
              Loading files…
            </p>
          ) : files.length === 0 ? (
            <p className="px-14 py-3 text-xs" style={{ color: "var(--color-muted)" }}>
              No files in this package.
            </p>
          ) : (
            <div className="divide-y max-h-[50vh] overflow-y-auto" style={{ borderColor: "var(--color-border)" }}>
              {/* Bundle download — shown when >1 complete file */}
              {files.filter((f) => f.uploadStatus === "complete").length > 1 && (
                <div className="px-14 py-2.5 flex justify-end" style={{ background: "var(--color-surface)" }}>
                  <button
                    onClick={() => void handleBundleDownload()}
                    disabled={bundleDownloading}
                    className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-sm text-white transition disabled:opacity-50"
                    style={{ background: "var(--color-accent)" }}
                  >
                    {bundleDownloading ? (
                      <>
                        <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
                        Building zip…
                      </>
                    ) : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                        Download all as .zip
                      </>
                    )}
                  </button>
                </div>
              )}
              {files.map((file) => (
                <div key={file.id} className="px-14 py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* File icon */}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)", flexShrink: 0 }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-xs text-[--color-ink] truncate">{file.filename}</p>
                      <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                        {formatBytes(file.sizeBytes)}
                        {file.uploadStatus !== "complete" && (
                          <span className="ml-2 capitalize">{file.uploadStatus}</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Download button — only for complete files */}
                    {file.uploadStatus === "complete" && (
                      <button
                        onClick={() => void handleDownload(file)}
                        disabled={downloadingId === file.id}
                        className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 border rounded-sm transition disabled:opacity-40"
                        style={{
                          borderColor: "var(--color-border)",
                          color: "var(--color-ink)",
                        }}
                        title="Download file"
                      >
                        {downloadingId === file.id ? (
                          <>
                            <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                            </svg>
                            Downloading…
                          </>
                        ) : (
                          <>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="8 17 12 21 16 17" />
                              <line x1="12" y1="12" x2="12" y2="21" />
                              <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.36" />
                            </svg>
                            Download
                          </>
                        )}
                      </button>
                    )}
                    {/* Delete file */}
                    <button
                      onClick={() => void handleDeleteFile(file.id)}
                      disabled={deletingFileId === file.id}
                      className="p-1.5 rounded transition opacity-30 hover:opacity-100 disabled:opacity-20"
                      style={{ color: "var(--color-ink)" }}
                      title="Delete file"
                      aria-label="Delete file"
                    >
                      {deletingFileId === file.id ? (
                        <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main dashboard ───────────────────────────────────────────────────────────
export default function DashboardClient() {
  const [packages, setPackages] = useState<ScanPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [resumePackageId, setResumePackageId] = useState<string | null>(null);
  const [addToPackageId, setAddToPackageId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [activeLicences, setActiveLicences] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);

  const fetchPackages = useCallback(async () => {
    try {
      const res = await fetch("/api/vault/packages");
      if (res.ok) {
        const data = await res.json() as { packages: ScanPackage[] };
        setPackages(data.packages);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPackages();
    void (async () => {
      try {
        const res = await fetch("/api/licences");
        if (res.ok) {
          const data = await res.json() as { licences: { status: string; validTo?: number | null }[] };
          const now = Math.floor(Date.now() / 1000);
          setActiveLicences(data.licences.filter((l) => l.status === "APPROVED" && (!l.validTo || l.validTo > now)).length);
          setPendingRequests(data.licences.filter((l) => l.status === "PENDING").length);
        }
      } catch { /* stats are non-critical */ }
    })();
  }, [fetchPackages]);

  function handleUploadComplete() {
    setModalOpen(false);
    setResumePackageId(null);
    setAddToPackageId(null);
    void fetchPackages();
  }

  function handleResume(packageId: string) {
    setResumePackageId(packageId);
    setAddToPackageId(null);
    setModalOpen(true);
  }

  function handleAddFiles(packageId: string) {
    setAddToPackageId(packageId);
    setResumePackageId(null);
    setModalOpen(true);
  }

  function handleDelete(packageId: string) {
    setConfirmDeleteId(packageId);
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return;
    setDeletingId(confirmDeleteId);
    setConfirmDeleteId(null);
    try {
      await fetch(`/api/vault/packages/${confirmDeleteId}`, { method: "DELETE" });
      setPackages((prev) => prev.filter((p) => p.id !== confirmDeleteId));
    } finally {
      setDeletingId(null);
    }
  }

  const totalSize = packages.reduce((acc, p) => acc + (p.totalSizeBytes ?? 0), 0);

  return (
    <div className="flex flex-col h-full">
      {/* ── Top bar ── */}
      <header
        className="flex items-center justify-between border-b px-8 lg:px-12 py-5"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[--color-ink]">
            Your Vault
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
            {loading ? "Loading…" : `${packages.length} scan package${packages.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium tracking-wide text-white transition"
          style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Scan Package
        </button>
      </header>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading…</p>
          </div>
        ) : packages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center max-w-xs">
              <div
                className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full"
                style={{ background: "var(--color-surface)" }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)" }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h2 className="text-sm font-semibold text-[--color-ink] mb-2">
                No scans yet
              </h2>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
                Upload your first likeness scan package. Files are encrypted in
                your browser before they leave your device.
              </p>
              <button
                onClick={() => setModalOpen(true)}
                className="mt-6 inline-flex items-center gap-2 border border-[--color-border] px-5 py-2.5 text-xs font-medium text-[--color-ink] transition hover:border-[--color-ink] hover:bg-[--color-surface]"
                style={{ borderRadius: "var(--radius)" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 16 12 12 8 16" />
                  <line x1="12" y1="12" x2="12" y2="21" />
                  <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                </svg>
                Upload Scan Package
              </button>
            </div>
          </div>
        ) : (
          <div className="px-8 lg:px-12 py-6 flex flex-col gap-3">
            {packages.map((pkg) => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                onDelete={handleDelete}
                onResume={handleResume}
                onAddFiles={handleAddFiles}
                deleting={deletingId === pkg.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Stats bar ── */}
      <footer
        className="border-t px-8 lg:px-12 py-4 flex items-center gap-8"
        style={{ borderColor: "var(--color-border)" }}
      >
        {[
          { label: "Total scans", value: loading ? "—" : String(packages.length) },
          { label: "Storage used", value: loading ? "—" : totalSize > 0 ? formatBytes(totalSize) : "0 B" },
          { label: "Active licences", value: loading ? "—" : String(activeLicences) },
          { label: "Pending requests", value: loading ? "—" : String(pendingRequests) },
        ].map((stat) => (
          <div key={stat.label}>
            <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
              {stat.label}
            </p>
            <p className="text-sm font-semibold text-[--color-ink] mt-0.5">
              {stat.value}
            </p>
          </div>
        ))}
      </footer>

      {/* ── Upload modal ── */}
      {modalOpen && (
        <UploadModal
          onClose={() => { setModalOpen(false); setResumePackageId(null); setAddToPackageId(null); }}
          onComplete={handleUploadComplete}
          resumePackageId={resumePackageId ?? undefined}
          addToPackageId={addToPackageId ?? undefined}
        />
      )}

      {/* ── Delete confirmation modal ── */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDeleteId(null); }}
        >
          <div
            className="rounded-lg shadow-xl w-full max-w-sm p-6"
            style={{ background: "var(--color-bg)" }}
          >
            <h2 className="text-base font-semibold mb-2" style={{ color: "var(--color-ink)" }}>
              Delete package?
            </h2>
            <p className="text-sm mb-5" style={{ color: "var(--color-muted)" }}>
              This package will be removed from your vault. An admin can restore it if needed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-xs font-medium rounded transition"
                style={{ color: "var(--color-ink)", border: "1px solid var(--color-border)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmDelete()}
                className="px-4 py-2 text-xs font-medium rounded transition text-white"
                style={{ background: "#991b1b" }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
