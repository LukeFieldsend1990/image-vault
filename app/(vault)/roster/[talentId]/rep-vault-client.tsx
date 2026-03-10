"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import UploadModal from "../../upload-modal";
import type { PreviewResponse } from "@/app/api/packages/[id]/preview/route";

interface ScanPackage {
  id: string;
  name: string;
  description: string | null;
  captureDate: number | null;
  studioName: string | null;
  totalSizeBytes: number | null;
  status: "uploading" | "ready" | "error";
  createdAt: number;
  fileCount: number;
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── Category colours (for preview panel) ─────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  raw: "#2563eb", exr: "#7c3aed", jpeg: "#059669", meta: "#9ca3af",
  mesh: "#d97706", video: "#dc2626", "360viewer": "#0891b2", docs: "#6b7280", other: "#9ca3af",
};

function PackagePreviewPanel({ packageId }: { packageId: string }) {
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

  if (loading) return <p className="px-5 pb-4 text-xs" style={{ color: "var(--color-muted)" }}>Loading preview…</p>;
  if (error || !data) return <p className="px-5 pb-4 text-xs" style={{ color: "var(--color-muted)" }}>Preview unavailable.</p>;

  const maxBarBytes = Math.max(...data.stats.map((s) => s.totalBytes), 1);

  return (
    <div className="px-5 py-4 space-y-5">
      {data.images.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
            Preview images ({data.images.length})
          </p>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
            {data.images.map((img, i) => (
              <div key={i} className="overflow-hidden rounded" style={{ aspectRatio: "3/4", background: "var(--color-border)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.filename} loading="lazy" className="h-full w-full object-cover"
                  onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
              </div>
            ))}
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

// ── Status helpers ────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  uploading: "#d97706",
  ready: "#166534",
  error: "#991b1b",
};

function PackageCard({
  pkg,
  onDelete,
  deleting,
}: {
  pkg: ScanPackage;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
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
    <div
      className="border rounded-sm overflow-hidden"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      {/* Main row */}
      <div className="px-5 py-4 flex items-center gap-4">
        <button
          onClick={toggleExpand}
          className="shrink-0 p-1 rounded transition opacity-40 hover:opacity-100"
          style={{ color: "var(--color-ink)" }}
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>{pkg.name}</p>
            <span
              className="shrink-0 text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
              style={{ background: `${statusColor}18`, color: statusColor }}
            >
              {pkg.status}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {pkg.studioName && (
              <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>{pkg.studioName}</span>
            )}
            {pkg.captureDate && (
              <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                {pkg.studioName && "· "}
                {new Date(pkg.captureDate * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right mr-2">
            <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
              {pkg.fileCount} file{pkg.fileCount !== 1 ? "s" : ""}
            </p>
            {pkg.totalSizeBytes != null && pkg.totalSizeBytes > 0 && (
              <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                {formatBytes(pkg.totalSizeBytes)}
              </p>
            )}
          </div>

          {/* Preview toggle */}
          {pkg.status === "ready" && (
            <button
              onClick={() => setPreviewOpen((v) => !v)}
              className="p-1.5 rounded transition opacity-40 hover:opacity-100"
              style={{ color: "var(--color-ink)" }}
              title="Preview scan"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}

          {/* Chain of custody */}
          <Link
            href={`/vault/packages/${pkg.id}/chain-of-custody`}
            className="p-1.5 rounded transition opacity-40 hover:opacity-100"
            style={{ color: "var(--color-ink)" }}
            title="Chain of custody"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </Link>

          {/* Delete */}
          <button
            onClick={() => onDelete(pkg.id)}
            disabled={deleting}
            className="p-1.5 rounded transition opacity-40 hover:opacity-100 disabled:opacity-20"
            style={{ color: "var(--color-ink)" }}
            title="Delete package"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6M9 6V4h6v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Preview panel */}
      {previewOpen && (
        <div className="border-t" style={{ borderColor: "var(--color-border)" }}>
          <PackagePreviewPanel packageId={pkg.id} />
        </div>
      )}

      {/* Expanded file list */}
      {expanded && (
        <div className="border-t" style={{ borderColor: "var(--color-border)" }}>
          {filesLoading ? (
            <p className="px-14 py-3 text-xs" style={{ color: "var(--color-muted)" }}>Loading files…</p>
          ) : files.length === 0 ? (
            <p className="px-14 py-3 text-xs" style={{ color: "var(--color-muted)" }}>No files in this package.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
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
                        <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                        </svg>
                        Building zip…
                      </>
                    ) : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Download all as .zip
                      </>
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
                    <button
                      onClick={() => void handleDownload(file)}
                      disabled={downloadingId === file.id}
                      className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 border rounded-sm transition disabled:opacity-40"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
                    >
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

// ── Main component ────────────────────────────────────────────────────────────

export default function RepVaultClient({ talentId }: { talentId: string }) {
  const [packages, setPackages] = useState<ScanPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [talent, setTalent] = useState<TalentInfo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notAllowed, setNotAllowed] = useState(false);

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

  // Fetch talent info from enriched roster endpoint
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
        Acting as representative
        <Link href="/roster" className="ml-auto underline opacity-70 hover:opacity-100">
          Back to roster
        </Link>
      </div>

      {/* Talent identity header */}
      <header
        className="flex items-center justify-between border-b px-8 py-5 gap-4"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-4 min-w-0">
          {/* Avatar */}
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
      </header>

      {/* Package list */}
      <div className="flex-1 overflow-y-auto">
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
      </div>

      {/* Stats bar */}
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
            <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
              {stat.label}
            </p>
            <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--color-ink)" }}>
              {stat.value}
            </p>
          </div>
        ))}
      </footer>

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
