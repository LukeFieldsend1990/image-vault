"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import UploadModal from "../../upload-modal";

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
            {pkg.status === "uploading" ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-700">
                Uploading
              </span>
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
                <span>{new Date(pkg.captureDate * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
              {pkg.fileCount} file{pkg.fileCount !== 1 ? "s" : ""}
            </p>
            {pkg.totalSizeBytes != null && pkg.totalSizeBytes > 0 && (
              <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                {formatBytes(pkg.totalSizeBytes)}
              </p>
            )}
          </div>
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

      {expanded && (
        <div className="border-t" style={{ borderColor: "var(--color-border)" }}>
          {filesLoading ? (
            <p className="px-14 py-3 text-xs" style={{ color: "var(--color-muted)" }}>Loading files…</p>
          ) : files.length === 0 ? (
            <p className="px-14 py-3 text-xs" style={{ color: "var(--color-muted)" }}>No files in this package.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
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

export default function RepVaultClient({ talentId }: { talentId: string }) {
  const [packages, setPackages] = useState<ScanPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [talentEmail, setTalentEmail] = useState<string | null>(null);
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

  // Fetch talent email from roster
  useEffect(() => {
    fetch("/api/roster")
      .then((r) => r.json() as Promise<{ roster?: Array<{ talentId: string; email: string }> }>)
      .then((d) => {
        const match = (d.roster ?? []).find((t) => t.talentId === talentId);
        if (match) setTalentEmail(match.email);
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
        Acting as representative for {talentEmail ?? talentId}
        <Link href="/roster" className="ml-auto underline opacity-70 hover:opacity-100">
          Back to roster
        </Link>
      </div>

      {/* Top bar */}
      <header
        className="flex items-center justify-between border-b px-8 py-5"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div>
          <h1 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
            {talentEmail ? `${talentEmail.split("@")[0]}'s Vault` : "Talent Vault"}
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

      {/* Content */}
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
