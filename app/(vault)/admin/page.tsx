export const runtime = "edge";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { users, scanPackages, licences, downloadEvents, scanFiles } from "@/lib/db/schema";
import { sql, inArray } from "drizzle-orm";

function fmt(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + " TB";
  if (n >= 1e9)  return (n / 1e9).toFixed(1) + " GB";
  if (n >= 1e6)  return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3)  return (n / 1e3).toFixed(1) + " KB";
  return n + " B";
}

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_COLOR: Record<string, string> = {
  PENDING: "#d97706",
  APPROVED: "#166534",
  DENIED: "#991b1b",
  REVOKED: "#6b7280",
  EXPIRED: "#9ca3af",
};

export default async function AdminOverviewPage() {
  await requireAdmin();
  const db = getDb();

  const [
    userCount,
    talentCount,
    repCount,
    licenseeCount,
    packageCount,
    storageRow,
    licenceCount,
    pendingCount,
    approvedCount,
    dlCount,
    recentDls,
    recentLicences,
  ] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(users).get(),
    db.select({ n: sql<number>`count(*)` }).from(users).where(sql`role = 'talent'`).get(),
    db.select({ n: sql<number>`count(*)` }).from(users).where(sql`role = 'rep'`).get(),
    db.select({ n: sql<number>`count(*)` }).from(users).where(sql`role = 'licensee'`).get(),
    db.select({ n: sql<number>`count(*)` }).from(scanPackages).get(),
    db.select({ total: sql<number>`coalesce(sum(total_size_bytes),0)` }).from(scanPackages).get(),
    db.select({ n: sql<number>`count(*)` }).from(licences).get(),
    db.select({ n: sql<number>`count(*)` }).from(licences).where(sql`status = 'PENDING'`).get(),
    db.select({ n: sql<number>`count(*)` }).from(licences).where(sql`status = 'APPROVED'`).get(),
    db.select({ n: sql<number>`count(*)` }).from(downloadEvents).get(),
    db.select({
      startedAt: downloadEvents.startedAt,
      licenseeId: downloadEvents.licenseeId,
      fileId: downloadEvents.fileId,
      bytesTransferred: downloadEvents.bytesTransferred,
    }).from(downloadEvents).orderBy(sql`started_at desc`).limit(8).all(),
    db.select({
      id: licences.id,
      projectName: licences.projectName,
      status: licences.status,
      createdAt: licences.createdAt,
    }).from(licences).orderBy(sql`created_at desc`).limit(6).all(),
  ]);

  // Resolve emails and filenames for recent downloads
  const dlUserIds = [...new Set(recentDls.map((d) => d.licenseeId))];
  const dlFileIds = [...new Set(recentDls.map((d) => d.fileId))];

  const [dlUsers, dlFiles] = await Promise.all([
    dlUserIds.length > 0
      ? db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, dlUserIds)).all()
      : Promise.resolve([] as { id: string; email: string }[]),
    dlFileIds.length > 0
      ? db.select({ id: scanFiles.id, filename: scanFiles.filename }).from(scanFiles).where(inArray(scanFiles.id, dlFileIds)).all()
      : Promise.resolve([] as { id: string; filename: string }[]),
  ]);
  const userEmailMap = new Map(dlUsers.map((u) => [u.id, u.email]));
  const fileNameMap = new Map(dlFiles.map((f) => [f.id, f.filename]));

  const statCards = [
    {
      label: "Total Users",
      value: String(userCount?.n ?? 0),
      sub: `${talentCount?.n ?? 0} talent · ${repCount?.n ?? 0} reps · ${licenseeCount?.n ?? 0} licensees`,
      href: "/admin/users",
    },
    {
      label: "Scan Packages",
      value: String(packageCount?.n ?? 0),
      sub: fmt(storageRow?.total ?? 0) + " stored",
      href: "/admin/packages",
    },
    {
      label: "Licences",
      value: String(licenceCount?.n ?? 0),
      sub: `${pendingCount?.n ?? 0} pending · ${approvedCount?.n ?? 0} active`,
      href: "/admin/licences",
    },
    {
      label: "Download Events",
      value: String(dlCount?.n ?? 0),
      sub: "all time",
      href: "/admin/downloads",
    },
    {
      label: "Pipeline Jobs",
      value: "→",
      sub: "Digital double pipeline",
      href: "/admin/pipeline",
    },
  ];

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[9px] uppercase tracking-[0.2em] font-semibold px-2 py-0.5 rounded"
            style={{ background: "rgba(192,57,43,0.12)", color: "var(--color-accent)" }}
          >
            Admin
          </span>
        </div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Platform Overview</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Platform-wide visibility across all users, packages and licences.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 mb-8 lg:grid-cols-4">
        {statCards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded border p-5 transition hover:opacity-80"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <p className="text-[10px] uppercase tracking-widest font-medium mb-2" style={{ color: "var(--color-muted)" }}>
              {c.label}
            </p>
            <p className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>{c.value}</p>
            <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>{c.sub}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Downloads */}
        <div className="rounded border" style={{ borderColor: "var(--color-border)" }}>
          <div
            className="px-5 py-3.5 border-b flex items-center justify-between"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              Recent Downloads
            </h2>
            <Link href="/admin/downloads" className="text-xs" style={{ color: "var(--color-accent)" }}>
              View all →
            </Link>
          </div>
          <div>
            {recentDls.length === 0 && (
              <p className="px-5 py-4 text-xs" style={{ color: "var(--color-muted)" }}>No downloads yet.</p>
            )}
            {recentDls.map((dl, i) => (
              <div
                key={i}
                className="px-5 py-3 border-b last:border-0"
                style={{ borderColor: "var(--color-border)" }}
              >
                <p className="text-xs font-medium truncate" style={{ color: "var(--color-ink)" }}>
                  {fileNameMap.get(dl.fileId) ?? dl.fileId.slice(0, 8) + "…"}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {userEmailMap.get(dl.licenseeId) ?? dl.licenseeId.slice(0, 10)} · {ts(dl.startedAt)}
                  {dl.bytesTransferred != null && <> · {fmt(dl.bytesTransferred)}</>}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Licence Requests */}
        <div className="rounded border" style={{ borderColor: "var(--color-border)" }}>
          <div
            className="px-5 py-3.5 border-b flex items-center justify-between"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              Recent Licences
            </h2>
            <Link href="/admin/licences" className="text-xs" style={{ color: "var(--color-accent)" }}>
              View all →
            </Link>
          </div>
          <div>
            {recentLicences.length === 0 && (
              <p className="px-5 py-4 text-xs" style={{ color: "var(--color-muted)" }}>No licence requests yet.</p>
            )}
            {recentLicences.map((l) => (
              <div
                key={l.id}
                className="px-5 py-3 border-b last:border-0 flex items-center justify-between gap-3"
                style={{ borderColor: "var(--color-border)" }}
              >
                <p className="text-xs font-medium truncate" style={{ color: "var(--color-ink)" }}>
                  {l.projectName}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
                    style={{
                      background: `${STATUS_COLOR[l.status ?? "PENDING"]}18`,
                      color: STATUS_COLOR[l.status ?? "PENDING"],
                    }}
                  >
                    {l.status}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--color-muted)" }}>{ts(l.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
