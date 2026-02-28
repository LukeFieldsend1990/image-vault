export const runtime = "edge";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { scanPackages, users, scanFiles, talentProfiles } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";

function fmt(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return (n / 1e12).toFixed(1) + " TB";
  if (n >= 1e9)  return (n / 1e9).toFixed(1) + " GB";
  if (n >= 1e6)  return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3)  return (n / 1e3).toFixed(1) + " KB";
  return n + " B";
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

  // File counts per package
  const fileCounts = await db
    .select({ packageId: scanFiles.packageId, n: sql<number>`count(*)` })
    .from(scanFiles)
    .groupBy(scanFiles.packageId)
    .all();
  const fileCountMap = new Map(fileCounts.map((f) => [f.packageId, f.n]));

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

        {pkgs.map((p) => (
          <div
            key={p.id}
            className="grid items-center px-5 py-3.5 border-b last:border-0 text-sm"
            style={{
              gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 1fr",
              borderColor: "var(--color-border)",
            }}
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
              {fileCountMap.get(p.id) ?? 0}
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
        ))}
      </div>
    </div>
  );
}
