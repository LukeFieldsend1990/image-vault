"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import UploadModal from "../../upload-modal";
import type { PreviewResponse } from "@/app/api/packages/[id]/preview/route";
import MonitorClient from "../../vault/monitor/monitor-client";
import type { TalentIdentityForMonitor } from "../../vault/monitor/page";

// ── Types ──────────────────────────────────────────────────────────────────────

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
  aiTags?: { tag: string; category: string; status: string }[];
}

interface ScanFile {
  id: string;
  filename: string;
  sizeBytes: number;
  contentType: string | null;
  uploadStatus: "pending" | "uploading" | "complete" | "error";
  createdAt: number;
}

interface TalentInfo {
  email: string;
  fullName: string | null;
  profileImageUrl: string | null;
}

interface Permission {
  licenceType: string;
  permission: "allowed" | "approval_required" | "blocked";
}

interface LicenceRow {
  id: string;
  projectName: string;
  productionCompany: string;
  licenceType: string | null;
  territory: string | null;
  status: string;
  agreedFee: number | null;
  platformFee: number | null;
  proposedFee: number | null;
  validFrom: number;
  validTo: number;
  approvedAt: number | null;
  downloadCount: number;
  licenseeEmail: string;
}

interface RevenueSummary {
  grossPence: number;
  talentPence: number;
  agencyPence: number;
  platformPence: number;
  licenceCount: number;
  talentSharePct?: number;
  agencySharePct?: number;
  platformSharePct?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtMoney(pence: number): string {
  if (pence === 0) return "$0";
  const dollars = pence / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function licenceTypeLabel(t: string | null): string {
  if (!t) return "—";
  const map: Record<string, string> = {
    commercial: "Commercial Ads",
    film_double: "Digital Stunt Double",
    game_character: "Video Game Character",
    ai_avatar: "AI Avatar",
    training_data: "Training Datasets",
    monitoring_reference: "Deepfake Protection",
  };
  return map[t] ?? t;
}

// ── Preview panel ──────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  raw: "#2563eb", exr: "#7c3aed", jpeg: "#059669", meta: "#9ca3af",
  mesh: "#d97706", video: "#dc2626", "360viewer": "#0891b2", docs: "#6b7280", other: "#9ca3af",
};

function PackagePreviewPanel({ packageId }: { packageId: string }) {
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
    <div className="px-5 py-4 space-y-5">
      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setLightbox(null)}>
          <div className="relative flex flex-col items-center gap-4 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setLightbox(null)}
              className="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full text-white transition hover:opacity-70"
              style={{ background: "rgba(255,255,255,0.15)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.filename} className="rounded max-w-full w-full object-contain" style={{ maxHeight: "70vh" }} />
            {lightbox.fileKey === coverKey ? (
              <div className="flex items-center gap-2 rounded px-4 py-2 text-sm font-medium" style={{ background: "var(--color-accent)", color: "#fff" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Current cover image
              </div>
            ) : (
              <button type="button" onClick={() => void setCover(lightbox.fileKey)} disabled={settingCover}
                className="flex items-center gap-2 rounded border px-4 py-2 text-sm font-medium transition hover:opacity-80 disabled:opacity-50"
                style={{ borderColor: "#fff", color: "#fff" }}>
                {settingCover
                  ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                }
                Set as cover image
              </button>
            )}
          </div>
        </div>
      )}

      {data.images.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
            Preview images ({data.images.length})
          </p>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
            {data.images.map((img, i) => {
              const isCover = img.fileKey === coverKey;
              return (
                <button key={i} type="button" onClick={() => setLightbox(img)}
                  className="relative overflow-hidden rounded cursor-pointer transition hover:opacity-90 active:scale-95"
                  style={{ aspectRatio: "3/4", background: "var(--color-border)", outline: isCover ? "2px solid var(--color-accent)" : "none", outlineOffset: "1px" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.filename} loading="lazy" className="h-full w-full object-cover"
                    onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
                  {isCover && (
                    <div className="absolute bottom-0 inset-x-0 text-center text-[9px] font-bold py-0.5" style={{ background: "var(--color-accent)", color: "#fff" }}>Cover</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {data.mp4Url && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>360° Reference Video</p>
          {videoOpen ? (
            <video src={data.mp4Url} controls autoPlay loop className="w-full rounded" style={{ maxHeight: 200, background: "#000" }} />
          ) : (
            <button onClick={() => setVideoOpen(true)}
              className="flex items-center gap-2 rounded border px-3 py-2 text-xs transition"
              style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
              </svg>
              Play 360° reference video
            </button>
          )}
        </div>
      )}
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
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Package card ───────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  uploading: "#d97706",
  ready: "#166534",
  error: "#991b1b",
};

function PackageCard({ pkg, onDelete, deleting }: { pkg: ScanPackage; onDelete: (id: string) => void; deleting: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [files, setFiles] = useState<ScanFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
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

  const statusColor = STATUS_COLOR[pkg.status];

  return (
    <div className="border rounded-sm overflow-hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <div className="px-4 sm:px-5 py-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={toggleExpand}
            className="shrink-0 p-1 rounded transition opacity-40 hover:opacity-100"
            style={{ color: "var(--color-ink)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          {pkg.coverImageKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/vault/packages/${pkg.id}/cover`} alt="Cover"
              className="shrink-0 rounded object-cover"
              style={{ width: 44, height: 58, background: "var(--color-border)" }} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 min-w-0">
              <p className="text-sm font-medium truncate min-w-0" style={{ color: "var(--color-ink)" }}>{pkg.name}</p>
              <span className="shrink-0 text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                style={{ background: `${statusColor}18`, color: statusColor }}>
                {pkg.status}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {pkg.studioName && <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>{pkg.studioName}</span>}
              {pkg.captureDate && (
                <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                  {pkg.studioName && "· "}
                  {new Date(pkg.captureDate * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              )}
            </div>
            {(pkg.aiTags ?? []).length > 0 && (
              <div className="hidden sm:flex flex-wrap gap-1 mt-1">
                {(pkg.aiTags ?? []).map((at) => (
                  <span key={`${at.category}:${at.tag}`} className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-sm"
                    style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                    {at.tag.replace(/-/g, " ")}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <div className="text-right mr-2">
              <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
                {pkg.fileCount} file{pkg.fileCount !== 1 ? "s" : ""}
              </p>
              {pkg.totalSizeBytes != null && pkg.totalSizeBytes > 0 && (
                <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>{formatBytes(pkg.totalSizeBytes)}</p>
              )}
            </div>
            {pkg.status === "ready" && (
              <button onClick={() => setPreviewOpen((v) => !v)}
                className="p-1.5 rounded transition opacity-40 hover:opacity-100"
                style={{ color: "var(--color-ink)" }} title="Preview scan">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            )}
            <Link href={`/vault/packages/${pkg.id}/chain-of-custody`}
              className="p-1.5 rounded transition opacity-40 hover:opacity-100"
              style={{ color: "var(--color-ink)" }} title="Chain of custody">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </Link>
            <button onClick={() => onDelete(pkg.id)} disabled={deleting}
              className="p-1.5 rounded transition opacity-40 hover:opacity-100 disabled:opacity-20"
              style={{ color: "var(--color-ink)" }} title="Delete package">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6M9 6V4h6v2" />
              </svg>
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
              <button onClick={() => setPreviewOpen((v) => !v)}
                className="p-1.5 rounded transition opacity-40 hover:opacity-100"
                style={{ color: "var(--color-ink)" }} title="Preview scan">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            )}
            <Link href={`/vault/packages/${pkg.id}/chain-of-custody`}
              className="p-1.5 rounded transition opacity-40 hover:opacity-100"
              style={{ color: "var(--color-ink)" }} title="Chain of custody">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </Link>
            <button onClick={() => onDelete(pkg.id)} disabled={deleting}
              className="p-1.5 rounded transition opacity-40 hover:opacity-100 disabled:opacity-20"
              style={{ color: "var(--color-ink)" }} title="Delete package">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6M9 6V4h6v2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {previewOpen && (
        <div className="border-t" style={{ borderColor: "var(--color-border)" }}>
          <PackagePreviewPanel packageId={pkg.id} />
        </div>
      )}

      {expanded && (
        <div className="border-t" style={{ borderColor: "var(--color-border)" }}>
          {filesLoading ? (
            <p className="px-14 py-3 text-xs" style={{ color: "var(--color-muted)" }}>Loading files…</p>
          ) : files.length === 0 ? (
            <p className="px-14 py-3 text-xs" style={{ color: "var(--color-muted)" }}>No files in this package.</p>
          ) : (
            <div className="divide-y max-h-[50vh] overflow-y-auto" style={{ borderColor: "var(--color-border)" }}>
              {files.filter((f) => f.uploadStatus === "complete").length > 1 && (
                <div className="px-14 py-2.5 flex justify-end" style={{ background: "var(--color-surface)" }}>
                  <button onClick={() => void handleBundleDownload()} disabled={bundleDownloading}
                    className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-sm text-white transition disabled:opacity-50"
                    style={{ background: "var(--color-accent)" }}>
                    {bundleDownloading ? (
                      <><svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                      </svg>Building zip…</>
                    ) : (
                      <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>Download all as .zip</>
                    )}
                  </button>
                </div>
              )}
              {files.map((file) => (
                <div key={file.id} className="px-14 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs truncate" style={{ color: "var(--color-ink)" }}>{file.filename}</p>
                    <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>{formatBytes(file.sizeBytes)}</p>
                  </div>
                  {file.uploadStatus === "complete" && (
                    <button onClick={() => void handleDownload(file)} disabled={downloadingId === file.id}
                      className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 border rounded-sm transition disabled:opacity-40"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}>
                      {downloadingId === file.id ? "Downloading…" : "Download"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Permissions tab ────────────────────────────────────────────────────────────

const LICENCE_TYPE_META: { type: string; label: string; description: string }[] = [
  { type: "commercial", label: "Commercial Ads", description: "TV, digital & out-of-home advertising" },
  { type: "film_double", label: "Digital Stunt Double", description: "De-aging, stunt replacement in film" },
  { type: "game_character", label: "Video Game Character", description: "In-engine game character or NPC" },
  { type: "ai_avatar", label: "AI Avatar", description: "Real-time synthetic likeness use" },
  { type: "training_data", label: "Training Datasets", description: "AI model training data inclusion" },
  { type: "monitoring_reference", label: "Deepfake Protection", description: "Monitoring / reference use only" },
];

const PERMISSION_OPTIONS: { value: Permission["permission"]; label: string; color: string }[] = [
  { value: "allowed", label: "Allowed", color: "#166534" },
  { value: "approval_required", label: "Approval Required", color: "#92400e" },
  { value: "blocked", label: "Blocked", color: "#991b1b" },
];

// ── Licences tab ──────────────────────────────────────────────────────────────

type LicenceStatus =
  | "AWAITING_PACKAGE"
  | "PENDING"
  | "APPROVED"
  | "DENIED"
  | "REVOKED"
  | "EXPIRED"
  | "SCRUB_PERIOD"
  | "CLOSED"
  | "OVERDUE";

interface LicenceItem {
  id: string;
  packageName: string | null;
  projectName: string;
  productionCompany: string;
  licenceType: string | null;
  status: LicenceStatus;
  validFrom: number;
  validTo: number;
  proposedFee: number | null;
  agreedFee: number | null;
  createdAt: number;
  downloadCount: number;
}

const STATUS_COLOURS: Record<LicenceStatus, string> = {
  AWAITING_PACKAGE: "#7c3aed",
  PENDING: "#b45309",
  APPROVED: "#166534",
  DENIED: "#991b1b",
  REVOKED: "#6b7280",
  EXPIRED: "#6b7280",
  SCRUB_PERIOD: "#c0392b",
  CLOSED: "#374151",
  OVERDUE: "#991b1b",
};

const LICENCE_TABS: { label: string; value: LicenceStatus | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Denied", value: "DENIED" },
];

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function LicencesTab({ talentId }: { talentId: string }) {
  const [allLicences, setAllLicences] = useState<LicenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<LicenceStatus | "ALL">("ALL");
  const [acting, setActing] = useState<string | null>(null);

  const fetchLicences = useCallback(() => {
    setLoading(true);
    fetch(`/api/licences?talentId=${talentId}`)
      .then((r) => r.json() as Promise<{ licences?: LicenceItem[] }>)
      .then((d) => setAllLicences(d.licences ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [talentId]);

  useEffect(() => { fetchLicences(); }, [fetchLicences]);

  async function handleAction(licenceId: string, action: "approve" | "deny") {
    setActing(licenceId);
    try {
      const res = await fetch(`/api/licences/${licenceId}/${action}`, { method: "POST" });
      if (res.ok) fetchLicences();
    } finally {
      setActing(null);
    }
  }

  const filtered = filter === "ALL" ? allLicences : allLicences.filter((l) => l.status === filter);
  const pendingCount = allLicences.filter((l) => l.status === "PENDING").length;

  if (loading) {
    return (
      <div className="px-8 py-6 space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 rounded border animate-pulse" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="px-8 py-6">
      {/* Filter tabs */}
      <div className="mb-5 flex gap-1 border-b" style={{ borderColor: "var(--color-border)" }}>
        {LICENCE_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setFilter(t.value)}
            className="px-3 py-2 text-xs transition relative"
            style={{
              color: filter === t.value ? "var(--color-ink)" : "var(--color-muted)",
              fontWeight: filter === t.value ? 600 : 400,
            }}
          >
            {t.label}
            {t.value === "PENDING" && pendingCount > 0 && (
              <span
                className="ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                style={{ background: "var(--color-accent)", minWidth: "18px" }}
              >
                {pendingCount}
              </span>
            )}
            {filter === t.value && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: "var(--color-accent)" }} />
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          {filter === "ALL" ? "No licences yet." : `No ${filter.toLowerCase()} licences.`}
        </p>
      )}

      <div className="space-y-2">
        {filtered.map((l) => {
          const fee = l.agreedFee ?? l.proposedFee;
          return (
            <div
              key={l.id}
              className="flex items-center justify-between gap-4 rounded border p-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    {l.projectName}
                  </p>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{ background: `${STATUS_COLOURS[l.status]}18`, color: STATUS_COLOURS[l.status] }}
                  >
                    {l.status}
                  </span>
                  {l.licenceType && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ background: "var(--color-border)", color: "var(--color-muted)" }}
                    >
                      {licenceTypeLabel(l.licenceType)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs" style={{ color: "var(--color-muted)" }}>
                  {l.productionCompany} · {l.packageName ?? "Unknown package"}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--color-muted)" }}>
                  {formatDate(l.validFrom)} – {formatDate(l.validTo)}
                  {fee ? ` · ${fmtMoney(fee)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {l.status === "PENDING" && (
                  <>
                    <button
                      onClick={() => handleAction(l.id, "approve")}
                      disabled={acting === l.id}
                      className="rounded px-3 py-1.5 text-xs font-medium text-white transition"
                      style={{ background: "#166534", opacity: acting === l.id ? 0.5 : 1 }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleAction(l.id, "deny")}
                      disabled={acting === l.id}
                      className="rounded border px-3 py-1.5 text-xs font-medium transition"
                      style={{ borderColor: "var(--color-border)", color: "#991b1b", opacity: acting === l.id ? 0.5 : 1 }}
                    >
                      Deny
                    </button>
                  </>
                )}
                {l.status === "APPROVED" && l.downloadCount > 0 && (
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {l.downloadCount} download{l.downloadCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PermissionsTab({ talentId }: { talentId: string }) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/roster/${talentId}/permissions`)
      .then((r) => r.json() as Promise<{ permissions: Permission[] }>)
      .then((d) => setPermissions(d.permissions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [talentId]);

  async function update(licenceType: string, permission: Permission["permission"]) {
    setSaving(licenceType);
    const prev = [...permissions];
    setPermissions((ps) => ps.map((p) => p.licenceType === licenceType ? { ...p, permission } : p));
    try {
      const res = await fetch(`/api/roster/${talentId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenceType, permission }),
      });
      if (!res.ok) setPermissions(prev);
    } catch {
      setPermissions(prev);
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-6 space-y-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-16 rounded border animate-pulse" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }} />
        ))}
      </div>
    );
  }

  const permMap = Object.fromEntries(permissions.map((p) => [p.licenceType, p.permission])) as Record<string, Permission["permission"]>;

  return (
    <div className="px-4 sm:px-8 py-6">
      <p className="text-xs mb-5" style={{ color: "var(--color-muted)" }}>
        Control which licence types can be used for this talent. Reps can set defaults on their behalf — talent can always override in their own settings.
      </p>
      <div className="space-y-3">
        {LICENCE_TYPE_META.map((meta) => {
          const current = permMap[meta.type] ?? "approval_required";
          const isSaving = saving === meta.type;
          const currentOption = PERMISSION_OPTIONS.find((o) => o.value === current)!;

          return (
            <div
              key={meta.type}
              className="rounded border px-5 py-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>{meta.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{meta.description}</p>
                </div>

                {/* Segmented control */}
                <div
                  className="flex items-center rounded self-start shrink-0 overflow-hidden w-full sm:w-auto"
                  style={{ border: "1px solid var(--color-border)" }}
                >
                  {PERMISSION_OPTIONS.map((opt, idx) => {
                    const active = current === opt.value;
                    const isLast = idx === PERMISSION_OPTIONS.length - 1;
                    return (
                      <button
                        key={opt.value}
                        disabled={isSaving}
                        onClick={() => void update(meta.type, opt.value)}
                        className="flex-1 sm:flex-none px-2 sm:px-3 py-1.5 text-[10px] sm:text-[11px] font-medium transition"
                        style={{
                          background: active ? `${opt.color}18` : "transparent",
                          color: active ? opt.color : "var(--color-muted)",
                          borderRight: isLast ? "none" : "1px solid var(--color-border)",
                          cursor: isSaving ? "wait" : "pointer",
                          opacity: isSaving && !active ? 0.5 : 1,
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Current state badge */}
              <div className="mt-2.5 flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: currentOption.color }} />
                <span className="text-[11px]" style={{ color: currentOption.color }}>
                  {currentOption.label}
                  {isSaving && " — saving…"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Revenue tab ────────────────────────────────────────────────────────────────

const LICENCE_STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  AWAITING_PACKAGE: { bg: "#7c3aed18", text: "#7c3aed" },
  APPROVED: { bg: "#16653418", text: "#166534" },
  PENDING: { bg: "#92400e18", text: "#92400e" },
  DENIED: { bg: "#99161618", text: "#991b1b" },
  REVOKED: { bg: "#99161618", text: "#991b1b" },
  EXPIRED: { bg: "#6b728018", text: "#6b7280" },
  SCRUB_PERIOD: { bg: "#c0392b18", text: "#c0392b" },
  CLOSED: { bg: "#37415118", text: "#374151" },
  OVERDUE: { bg: "#99161618", text: "#991b1b" },
};

function RevenueSummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div
      className="rounded border px-5 py-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <p className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: "var(--color-muted)" }}>
        {label}
      </p>
      <p className="text-xl font-semibold" style={{ color: color ?? "var(--color-ink)" }}>{value}</p>
      {sub && <p className="text-[11px] mt-1" style={{ color: "var(--color-muted)" }}>{sub}</p>}
    </div>
  );
}

function RevenueTab({ talentId }: { talentId: string }) {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [licenceRows, setLicenceRows] = useState<LicenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/roster/${talentId}/revenue`)
      .then((r) => r.json() as Promise<{ summary: RevenueSummary; licences: LicenceRow[] }>)
      .then((d) => {
        setSummary(d.summary);
        setLicenceRows(d.licences);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [talentId]);

  const approved = licenceRows.filter((l) => l.status === "APPROVED");
  const pending = licenceRows.filter((l) => l.status === "PENDING");

  if (loading) {
    return (
      <div className="px-8 py-6 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded border animate-pulse" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 py-6">
      {/* Summary cards */}
      {(() => {
        const t = summary?.talentSharePct ?? 65;
        const a = summary?.agencySharePct ?? 20;
        const p = summary?.platformSharePct ?? 15;
        return (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
              <RevenueSummaryCard
                label="Gross Licence Value"
                value={fmtMoney(summary?.grossPence ?? 0)}
                sub={`${summary?.licenceCount ?? 0} approved licence${(summary?.licenceCount ?? 0) !== 1 ? "s" : ""}`}
                color="var(--color-accent)"
              />
              <RevenueSummaryCard
                label={`Talent Share (${t}%)`}
                value={fmtMoney(summary?.talentPence ?? 0)}
              />
              <RevenueSummaryCard
                label={`Agency Commission (${a}%)`}
                value={fmtMoney(summary?.agencyPence ?? 0)}
              />
              <RevenueSummaryCard
                label={`Platform Fee (${p}%)`}
                value={fmtMoney(summary?.platformPence ?? 0)}
              />
            </div>

            {(summary?.grossPence ?? 0) > 0 && (
              <div className="mb-8">
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
                  Revenue split
                </p>
                <div className="flex h-3 rounded-full overflow-hidden gap-px">
                  <div className="h-full" style={{ width: `${t}%`, background: "var(--color-accent)", opacity: 0.9 }} title={`Talent ${t}%`} />
                  <div className="h-full" style={{ width: `${a}%`, background: "var(--color-ink)", opacity: 0.5 }} title={`Agency ${a}%`} />
                  <div className="h-full" style={{ width: `${p}%`, background: "var(--color-muted)", opacity: 0.4 }} title={`Platform ${p}%`} />
                </div>
                <div className="flex items-center gap-4 mt-2">
                  {[
                    { label: `Talent ${t}%`, color: "var(--color-accent)", opacity: 0.9 },
                    { label: `Agency ${a}%`, color: "var(--color-ink)", opacity: 0.5 },
                    { label: `Platform ${p}%`, color: "var(--color-muted)", opacity: 0.4 },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: item.color, opacity: item.opacity }} />
                      <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Licence history */}
      {licenceRows.length === 0 ? (
        <div className="rounded border p-8 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>No licence history yet.</p>
        </div>
      ) : (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--color-muted)" }}>
            Licence history
          </p>
          <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
            {/* Table header */}
            <div
              className="grid grid-cols-[1fr_auto_auto_auto] sm:grid-cols-[1fr_1fr_auto_auto_auto] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-widest font-semibold border-b"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-muted)",
              }}
            >
              <span>Project</span>
              <span className="hidden sm:block">Type</span>
              <span className="text-right">Fee</span>
              <span className="text-right">Status</span>
              <span />
            </div>
            {licenceRows.map((licence, i) => {
              const statusStyle = LICENCE_STATUS_COLOR[licence.status] ?? { bg: "#6b728018", text: "#6b7280" };
              const fee = licence.agreedFee ?? licence.proposedFee;
              const expanded = expandedId === licence.id;
              const fmtDate = (ts: number | null) =>
                ts ? new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
              return (
                <div
                  key={licence.id}
                  className="border-b last:border-b-0"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  {/* Clickable summary row */}
                  <div
                    className="grid grid-cols-[1fr_auto_auto_auto] sm:grid-cols-[1fr_1fr_auto_auto_auto] gap-3 px-4 py-3 items-center cursor-pointer select-none"
                    style={{ background: i % 2 === 0 ? "var(--color-bg)" : "var(--color-surface)" }}
                    onClick={() => setExpandedId(expanded ? null : licence.id)}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: "var(--color-ink)" }}>
                        {licence.projectName}
                      </p>
                      <p className="text-[11px] truncate" style={{ color: "var(--color-muted)" }}>
                        {licence.productionCompany}
                      </p>
                    </div>
                    <div className="hidden sm:block min-w-0">
                      <p className="text-xs truncate" style={{ color: "var(--color-ink)" }}>
                        {licenceTypeLabel(licence.licenceType)}
                      </p>
                      {licence.territory && (
                        <p className="text-[11px] truncate" style={{ color: "var(--color-muted)" }}>
                          {licence.territory}
                        </p>
                      )}
                    </div>
                    <span className="text-xs font-mono text-right" style={{ color: fee ? "var(--color-ink)" : "var(--color-muted)" }}>
                      {fee ? fmtMoney(fee) : "—"}
                    </span>
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded"
                      style={{ background: statusStyle.bg, color: statusStyle.text }}
                    >
                      {licence.status}
                    </span>
                    <svg
                      width="12" height="12" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{
                        color: "var(--color-muted)",
                        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.15s",
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>

                  {/* Expanded detail panel */}
                  {expanded && (
                    <div
                      className="px-4 py-4 border-t text-xs"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                    >
                      <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-3">
                        {licence.licenceType && (
                          <div className="sm:hidden">
                            <p className="mb-0.5" style={{ color: "var(--color-muted)" }}>Type</p>
                            <p className="font-medium" style={{ color: "var(--color-ink)" }}>{licenceTypeLabel(licence.licenceType)}</p>
                          </div>
                        )}
                        {licence.territory && (
                          <div className="sm:hidden">
                            <p className="mb-0.5" style={{ color: "var(--color-muted)" }}>Territory</p>
                            <p className="font-medium" style={{ color: "var(--color-ink)" }}>{licence.territory}</p>
                          </div>
                        )}
                        <div>
                          <p className="mb-0.5" style={{ color: "var(--color-muted)" }}>Licensee</p>
                          <p className="font-medium break-all" style={{ color: "var(--color-ink)" }}>{licence.licenseeEmail}</p>
                        </div>
                        <div>
                          <p className="mb-0.5" style={{ color: "var(--color-muted)" }}>Valid period</p>
                          <p className="font-medium" style={{ color: "var(--color-ink)" }}>
                            {fmtDate(licence.validFrom)} – {fmtDate(licence.validTo)}
                          </p>
                        </div>
                        <div>
                          <p className="mb-0.5" style={{ color: "var(--color-muted)" }}>Approved</p>
                          <p className="font-medium" style={{ color: "var(--color-ink)" }}>{fmtDate(licence.approvedAt)}</p>
                        </div>
                        <div>
                          <p className="mb-0.5" style={{ color: "var(--color-muted)" }}>Downloads</p>
                          <p className="font-medium" style={{ color: "var(--color-ink)" }}>{licence.downloadCount}</p>
                        </div>
                      </div>
                      {fee !== null && (
                        <div
                          className="pt-3 border-t space-y-1.5"
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          <div className="flex justify-between">
                            <span style={{ color: "var(--color-muted)" }}>{licence.agreedFee ? "Agreed fee" : "Proposed fee"}</span>
                            <span style={{ color: "var(--color-ink)" }}>{fmtMoney(fee)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span style={{ color: "var(--color-muted)" }}>Platform (15%)</span>
                            <span style={{ color: "var(--color-muted)" }}>−{fmtMoney(Math.round(fee * 0.15))}</span>
                          </div>
                          <div className="flex justify-between">
                            <span style={{ color: "var(--color-muted)" }}>Agency (20%)</span>
                            <span style={{ color: "var(--color-muted)" }}>−{fmtMoney(Math.round(fee * 0.2))}</span>
                          </div>
                          <div
                            className="flex justify-between font-semibold border-t pt-1.5"
                            style={{ borderColor: "var(--color-border)", color: "var(--color-accent)" }}
                          >
                            <span>Talent earnings</span>
                            <span>{fmtMoney(fee - Math.round(fee * 0.15) - Math.round(fee * 0.2))}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type Tab = "vault" | "licences" | "permissions" | "revenue" | "monitor";

export default function RepVaultClient({ talentId }: { talentId: string }) {
  const [packages, setPackages] = useState<ScanPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [talent, setTalent] = useState<TalentInfo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notAllowed, setNotAllowed] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("vault");

  const fetchPackages = useCallback(async () => {
    try {
      const res = await fetch(`/api/vault/packages?for=${talentId}`);
      if (res.status === 403) {
        setNotAllowed(true);
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as { packages: ScanPackage[] };
        setPackages(data.packages);
      }
    } finally {
      setLoading(false);
    }
  }, [talentId]);

  useEffect(() => {
    fetch("/api/roster")
      .then((r) => r.json() as Promise<{ roster?: Array<{ talentId: string; email: string; fullName: string | null; profileImageUrl: string | null }> }>)
      .then((d) => {
        const match = (d.roster ?? []).find((t) => t.talentId === talentId);
        if (match) setTalent({ email: match.email, fullName: match.fullName, profileImageUrl: match.profileImageUrl });
      })
      .catch(() => {});
  }, [talentId]);

  useEffect(() => { void fetchPackages(); }, [fetchPackages]);

  async function handleDelete(packageId: string) {
    setDeletingId(packageId);
    try {
      await fetch(`/api/vault/packages/${packageId}`, { method: "DELETE" });
      setPackages((prev) => prev.filter((p) => p.id !== packageId));
    } finally {
      setDeletingId(null);
    }
  }

  if (notAllowed) {
    return (
      <div className="p-8 max-w-lg">
        <Link href="/roster" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          My Roster
        </Link>
        <p className="text-sm" style={{ color: "var(--color-danger)" }}>
          You do not have access to manage this talent&apos;s vault.
        </p>
      </div>
    );
  }

  const totalSize = packages.reduce((acc, p) => acc + (p.totalSizeBytes ?? 0), 0);
  const displayName = talent?.fullName ?? talent?.email ?? talentId;
  const avatarInitials = talent?.fullName
    ? talent.fullName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : (talent?.email ?? "?")[0].toUpperCase();

  const TABS: { id: Tab; label: string }[] = [
    { id: "vault", label: "Vault" },
    { id: "licences", label: "Licences" },
    { id: "permissions", label: "Permissions" },
    { id: "revenue", label: "Revenue" },
    { id: "monitor", label: "DeepScan" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Acting-as banner */}
      <div
        className="flex items-center gap-2 px-8 py-2.5 text-xs font-medium"
        style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-accent)" }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        Acting on behalf of <strong>{displayName}</strong>
        <Link href="/roster" className="ml-auto underline opacity-70 hover:opacity-100">
          Back to roster
        </Link>
      </div>

      {/* Talent identity header */}
      <header className="flex items-center justify-between border-b px-8 py-5 gap-4" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-4 min-w-0">
          {talent?.profileImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={talent.profileImageUrl}
              alt={displayName}
              className="h-12 w-12 rounded-full object-cover shrink-0"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          ) : (
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full shrink-0 text-base font-semibold"
              style={{ background: "var(--color-ink)", color: "#fff" }}
            >
              {avatarInitials}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight truncate" style={{ color: "var(--color-ink)" }}>
              {displayName}
            </h1>
            {talent?.fullName && (
              <p className="text-xs truncate" style={{ color: "var(--color-muted)" }}>{talent.email}</p>
            )}
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              {loading ? "Loading…" : `${packages.length} scan package${packages.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>

        {activeTab === "vault" && (
          <button
            onClick={() => setModalOpen(true)}
            className="shrink-0 flex items-center gap-2 px-4 py-2.5 text-xs font-medium tracking-wide text-white transition"
            style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Scan Package
          </button>
        )}
      </header>

      {/* Tab bar */}
      <div className="flex border-b px-8" style={{ borderColor: "var(--color-border)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="relative py-3 px-1 mr-6 text-sm font-medium transition"
            style={{ color: activeTab === tab.id ? "var(--color-ink)" : "var(--color-muted)" }}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ background: "var(--color-accent)" }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "vault" && (
          <>
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading…</p>
              </div>
            ) : packages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center max-w-xs">
                  <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink)" }}>No scans yet</p>
                  <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                    Upload the first scan package for this talent.
                  </p>
                  <button
                    onClick={() => setModalOpen(true)}
                    className="mt-6 inline-flex items-center gap-2 border border-[--color-border] px-5 py-2.5 text-xs font-medium text-[--color-ink] transition hover:border-[--color-ink]"
                    style={{ borderRadius: "var(--radius)" }}
                  >
                    Upload Scan Package
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-8 py-6 flex flex-col gap-3">
                {packages.map((pkg) => (
                  <PackageCard
                    key={pkg.id}
                    pkg={pkg}
                    onDelete={handleDelete}
                    deleting={deletingId === pkg.id}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "licences" && <LicencesTab talentId={talentId} />}
        {activeTab === "permissions" && <PermissionsTab talentId={talentId} />}
        {activeTab === "revenue" && <RevenueTab talentId={talentId} />}
        {activeTab === "monitor" && (() => {
          const monitorIdentity: TalentIdentityForMonitor | null = talent?.fullName
            ? { fullName: talent.fullName, profileImageUrl: talent.profileImageUrl ?? null, knownFor: [] }
            : null;
          return <MonitorClient identity={monitorIdentity} />;
        })()}
      </div>

      {/* Stats bar — only on vault tab */}
      {activeTab === "vault" && (
        <footer
          className="border-t px-8 py-4 flex items-center gap-8"
          style={{ borderColor: "var(--color-border)" }}
        >
          {[
            { label: "Total scans", value: loading ? "—" : String(packages.length) },
            { label: "Storage used", value: loading ? "—" : totalSize > 0 ? formatBytes(totalSize) : "0 B" },
            { label: "Ready", value: loading ? "—" : String(packages.filter((p) => p.status === "ready").length) },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>{stat.label}</p>
              <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--color-ink)" }}>{stat.value}</p>
            </div>
          ))}
        </footer>
      )}

      {modalOpen && (
        <UploadModal
          onClose={() => setModalOpen(false)}
          onComplete={() => { setModalOpen(false); void fetchPackages(); }}
          forTalentId={talentId}
        />
      )}
    </div>
  );
}
