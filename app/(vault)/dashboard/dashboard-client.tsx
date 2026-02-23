"use client";

import { useState, useEffect, useCallback } from "react";
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

export default function DashboardClient() {
  const [packages, setPackages] = useState<ScanPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
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
    void fetchPackages();
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
              <div
                key={pkg.id}
                className="border rounded-sm px-5 py-4 flex items-center justify-between gap-4"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium text-[--color-ink] truncate">
                      {pkg.name}
                    </p>
                    {pkg.status === "uploading" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-700">
                        <svg className="animate-spin" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                        </svg>
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
                        <span>{formatDate(pkg.captureDate)}</span>
                      </>
                    )}
                  </div>
                </div>
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
                  <button
                    onClick={() => void handleDelete(pkg.id)}
                    disabled={deletingId === pkg.id}
                    className="p-1.5 rounded transition opacity-40 hover:opacity-100 disabled:opacity-20"
                    style={{ color: "var(--color-ink)" }}
                    title="Delete package"
                    aria-label="Delete package"
                  >
                    {deletingId === pkg.id ? (
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
          onClose={() => setModalOpen(false)}
          onComplete={handleUploadComplete}
        />
      )}
    </div>
  );
}
