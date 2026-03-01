"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import UploadModal from "../upload-modal";

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

// ── Package card (handles its own expanded/file state) ───────────────────────
function PackageCard({
  pkg,
  onDelete,
  onResume,
  deleting,
}: {
  pkg: ScanPackage;
  onDelete: (id: string) => void;
  onResume: (id: string) => void;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState<ScanFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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

  return (
    <div
      className="border rounded-sm overflow-hidden"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      {/* ── Header row ── */}
      <div className="px-5 py-4 flex items-center gap-4">
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

        {/* Meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
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
          <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--color-muted)" }}>
            {pkg.studioName && <span>{pkg.studioName}</span>}
            {pkg.captureDate && (
              <>
                {pkg.studioName && <span>·</span>}
                <span>{formatDate(pkg.captureDate)}</span>
              </>
            )}
          </div>
        </div>

        {/* Right side: file count + size + actions */}
        <div className="flex items-center gap-4 shrink-0">
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
          {/* Chain of custody */}
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
            <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
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
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
  }, [fetchPackages]);

  function handleUploadComplete() {
    setModalOpen(false);
    setResumePackageId(null);
    void fetchPackages();
  }

  function handleResume(packageId: string) {
    setResumePackageId(packageId);
    setModalOpen(true);
  }

  async function handleDelete(packageId: string) {
    setDeletingId(packageId);
    try {
      await fetch(`/api/vault/packages/${packageId}`, { method: "DELETE" });
      setPackages((prev) => prev.filter((p) => p.id !== packageId));
    } finally {
      setDeletingId(null);
    }
  }

  const totalSize = packages.reduce((acc, p) => acc + (p.totalSizeBytes ?? 0), 0);

  return (
    <div className="flex flex-col h-full">
      {/* ── Top bar ── */}
      <header
        className="flex items-center justify-between border-b px-8 py-5"
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
          <div className="px-8 py-6 flex flex-col gap-3">
            {packages.map((pkg) => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                onDelete={handleDelete}
                onResume={handleResume}
                deleting={deletingId === pkg.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Stats bar ── */}
      <footer
        className="border-t px-8 py-4 flex items-center gap-8"
        style={{ borderColor: "var(--color-border)" }}
      >
        {[
          { label: "Total scans", value: loading ? "—" : String(packages.length) },
          { label: "Storage used", value: loading ? "—" : totalSize > 0 ? formatBytes(totalSize) : "0 B" },
          { label: "Active licences", value: "0" },
          { label: "Pending requests", value: "0" },
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
          onClose={() => { setModalOpen(false); setResumePackageId(null); }}
          onComplete={handleUploadComplete}
          resumePackageId={resumePackageId ?? undefined}
        />
      )}
    </div>
  );
}
