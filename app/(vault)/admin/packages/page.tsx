export const runtime = "edge";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import AdminPackagePreviewToggle from "./preview-panel";
import { getDb } from "@/lib/db";
import { scanPackages, users, scanFiles, talentProfiles, downloadEvents } from "@/lib/db/schema";
import { sql, eq, isNull } from "drizzle-orm";

const DL_STALE_SECS = 2 * 60 * 60; // 2 hours — matches admin downloads page

function fmt(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return (n / 1e12).toFixed(1) + " TB";
  if (n >= 1e9)  return (n / 1e9).toFixed(1) + " GB";
  if (n >= 1e6)  return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3)  return (n / 1e3).toFixed(1) + " KB";
  return n + " B";
}

function fmtDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

const STATUS_COLOR: Record<string, string> = {
  uploading: "#d97706",
  ready: "#166534",
  error: "#991b1b",
};

export default async function AdminPackagesPage() {
  await requireAdmin();
  const db = getDb();

  // All packages with talent email and profile name
  const pkgs = await db
    .select({
      id: scanPackages.id,
      name: scanPackages.name,
      status: scanPackages.status,
      totalSizeBytes: scanPackages.totalSizeBytes,
      captureDate: scanPackages.captureDate,
      studioName: scanPackages.studioName,
      createdAt: scanPackages.createdAt,
      talentId: scanPackages.talentId,
      talentEmail: users.email,
    })
    .from(scanPackages)
    .innerJoin(users, eq(users.id, scanPackages.talentId))
    .orderBy(sql`${scanPackages.createdAt} desc`)
    .all();

  // Files per package (for inline listing)
  const allFiles = await db
    .select({
      id: scanFiles.id,
      packageId: scanFiles.packageId,
      filename: scanFiles.filename,
      sizeBytes: scanFiles.sizeBytes,
      uploadStatus: scanFiles.uploadStatus,
      createdAt: scanFiles.createdAt,
      completedAt: scanFiles.completedAt,
    })
    .from(scanFiles)
    .orderBy(scanFiles.filename)
    .all();

  const filesByPackage = new Map<string, typeof allFiles>();
  for (const f of allFiles) {
    const arr = filesByPackage.get(f.packageId) ?? [];
    arr.push(f);
    filesByPackage.set(f.packageId, arr);
  }

  // Pending downloads per file (completedAt null = not yet streamed)
  // eslint-disable-next-line react-hooks/purity -- server component, Date.now() is intentional
  const now = Math.floor(Date.now() / 1000);
  const pendingDls = allFiles.length > 0
    ? await db
        .select({ fileId: downloadEvents.fileId, startedAt: downloadEvents.startedAt })
        .from(downloadEvents)
        .where(isNull(downloadEvents.completedAt))
        .all()
    : [];

  // Map fileId → count of pending (non-stale) download events
  const pendingDlMap = new Map<string, number>();
  for (const dl of pendingDls) {
    if (now - dl.startedAt <= DL_STALE_SECS) {
      pendingDlMap.set(dl.fileId, (pendingDlMap.get(dl.fileId) ?? 0) + 1);
    }
  }

  // Talent names
  const profiles = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .all();
  const profileMap = new Map(profiles.map((p) => [p.userId, p.fullName]));

  // Totals
  const totalSize = pkgs.reduce((s, p) => s + (p.totalSizeBytes ?? 0), 0);

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Scan Packages</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          {pkgs.length} packages across all talent · {fmt(totalSize)} total storage
        </p>
      </div>

      <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
        {/* Header */}
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3"
          style={{
            gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 1fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Package</span>
          <span>Talent</span>
          <span>Files</span>
          <span>Size</span>
          <span>Status</span>
          <span>Created</span>
        </div>

        {pkgs.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>No packages yet.</p>
        )}

        {pkgs.map((p) => {
          const files = filesByPackage.get(p.id) ?? [];
          return (
            <div key={p.id} className="border-b last:border-0" style={{ borderColor: "var(--color-border)" }}>
              {/* Main row */}
              <div
                className="grid items-center px-5 py-3.5 text-sm"
                style={{ gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 1fr" }}
              >
                {/* Package name + chain of custody link */}
                <div className="min-w-0">
                  <p className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{p.name}</p>
                  {p.studioName && (
                    <p className="text-[11px] truncate" style={{ color: "var(--color-muted)" }}>{p.studioName}</p>
                  )}
                  <Link
                    href={`/vault/packages/${p.id}/chain-of-custody`}
                    className="text-[10px] mt-0.5 inline-block"
                    style={{ color: "var(--color-accent)" }}
                  >
                    Chain of custody →
                  </Link>
                </div>

                {/* Talent */}
                <div className="min-w-0">
                  <p className="text-xs truncate" style={{ color: "var(--color-text)" }}>
                    {profileMap.get(p.talentId) ?? p.talentEmail}
                  </p>
                  {profileMap.has(p.talentId) && (
                    <p className="text-[10px] truncate" style={{ color: "var(--color-muted)" }}>{p.talentEmail}</p>
                  )}
                </div>

                {/* File count */}
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {files.length} file{files.length !== 1 ? "s" : ""}
                </span>

                {/* Size */}
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {fmt(p.totalSizeBytes)}
                </span>

                {/* Status */}
                <span
                  className="inline-flex items-center text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded w-fit"
                  style={{
                    background: `${STATUS_COLOR[p.status ?? "uploading"]}18`,
                    color: STATUS_COLOR[p.status ?? "uploading"],
                  }}
                >
                  {p.status}
                </span>

                {/* Created */}
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {ts(p.createdAt)}
                </span>
              </div>

              {/* File list — collapsible */}
              {files.length > 0 && (
                <details style={{ borderTop: "1px solid var(--color-border)" }}>
                  <summary
                    className="px-5 py-2 text-[10px] font-medium uppercase tracking-widest cursor-pointer select-none list-none flex items-center gap-1.5"
                    style={{ color: "var(--color-muted)" }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="details-chevron">
                      <path d="M2 3 L5 7 L8 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    {files.length} file{files.length !== 1 ? "s" : ""}
                    {files.filter(f => (pendingDlMap.get(f.id) ?? 0) > 0).length > 0 && (
                      <span className="ml-1 text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide" style={{ background: "#d9770618", color: "#d97706" }}>
                        {files.reduce((n, f) => n + (pendingDlMap.get(f.id) ?? 0), 0)} download{files.reduce((n, f) => n + (pendingDlMap.get(f.id) ?? 0), 0) !== 1 ? "s" : ""} pending
                      </span>
                    )}
                  </summary>
                  <div className="px-5 pb-3 flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: "240px" }}>
                  {files.map((f) => {
                    const isComplete = f.uploadStatus === "complete";
                    const isUploading = f.uploadStatus === "uploading";
                    const fileColor = isComplete ? "#166534" : isUploading ? "#d97706" : "#6b7280";
                    const duration = f.completedAt && f.createdAt
                      ? fmtDuration(f.completedAt - f.createdAt)
                      : null;
                    const pendingCount = pendingDlMap.get(f.id) ?? 0;
                    return (
                      <div key={f.id} className="flex items-center gap-3 py-1">
                        <span
                          className="shrink-0 text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: `${fileColor}18`, color: fileColor }}
                        >
                          {f.uploadStatus}
                        </span>
                        <span className="text-xs font-mono truncate flex-1" style={{ color: "var(--color-ink)" }}>
                          {f.filename}
                        </span>
                        {pendingCount > 0 && (
                          <span
                            className="shrink-0 text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: "#d9770618", color: "#d97706" }}
                          >
                            {pendingCount} download{pendingCount > 1 ? "s" : ""} pending
                          </span>
                        )}
                        <span className="text-xs shrink-0" style={{ color: "var(--color-muted)" }}>
                          {fmt(f.sizeBytes)}
                        </span>
                        {duration && (
                          <span className="text-[10px] shrink-0" style={{ color: "var(--color-muted)" }}>
                            {duration}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </details>
              )}

              {/* Preview scan — only for ready packages */}
              {p.status === "ready" && <AdminPackagePreviewToggle packageId={p.id} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
