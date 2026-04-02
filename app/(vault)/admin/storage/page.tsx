export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { users, scanPackages, scanFiles, talentProfiles } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

function fmt(bytes: number): string {
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(2) + " TB";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(1) + " KB";
}

export default async function AdminStoragePage() {
  await requireAdmin();
  const db = getDb();

  // All talent users with storage aggregated from completed files only
  const rows = await db
    .select({
      talentId: users.id,
      email: users.email,
      totalBytes: sql<number>`coalesce(sum(case when ${scanFiles.uploadStatus} = 'complete' then ${scanFiles.sizeBytes} else 0 end), 0)`,
      packageCount: sql<number>`count(distinct ${scanPackages.id})`,
      fileCount: sql<number>`count(case when ${scanFiles.uploadStatus} = 'complete' then ${scanFiles.id} end)`,
    })
    .from(users)
    .leftJoin(scanPackages, eq(scanPackages.talentId, users.id))
    .leftJoin(scanFiles, eq(scanFiles.packageId, scanPackages.id))
    .where(eq(users.role, "talent"))
    .groupBy(users.id)
    .orderBy(sql`coalesce(sum(case when ${scanFiles.uploadStatus} = 'complete' then ${scanFiles.sizeBytes} else 0 end), 0) desc`)
    .all();

  const allProfiles = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .all();

  const profileMap = new Map(allProfiles.map((p) => [p.userId, p.fullName]));

  const totalBytes = rows.reduce((acc, r) => acc + (r.totalBytes ?? 0), 0);

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Storage</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Platform-wide storage usage. Total: <strong style={{ color: "var(--color-ink)" }}>{fmt(totalBytes)}</strong> across {rows.length} talent account{rows.length !== 1 ? "s" : ""}.
        </p>
      </div>

      <p className="text-[10px] text-right sm:hidden mb-1" style={{ color: "var(--color-muted)" }}>Scroll for more →</p>
      <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        {/* Header */}
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[600px]"
          style={{
            gridTemplateColumns: "2fr 1fr 1fr 1fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Talent</span>
          <span>Packages</span>
          <span>Files</span>
          <span>Storage used</span>
        </div>

        {rows.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>No completed uploads yet.</p>
        )}

        {rows.map((r) => {
          const bytes = r.totalBytes ?? 0;
          const pct = totalBytes > 0 ? Math.round((bytes / totalBytes) * 100) : 0;
          return (
            <div
              key={r.talentId}
              className="grid items-center px-5 py-3.5 border-b last:border-0 text-sm min-w-[600px]"
              style={{
                gridTemplateColumns: "2fr 1fr 1fr 1fr",
                borderColor: "var(--color-border)",
              }}
            >
              {/* Talent identity */}
              <div className="min-w-0">
                <p className="truncate text-sm" style={{ color: "var(--color-text)" }}>
                  {profileMap.get(r.talentId) ?? r.email}
                </p>
                {profileMap.has(r.talentId) && (
                  <p className="truncate text-xs" style={{ color: "var(--color-muted)" }}>
                    {r.email}
                  </p>
                )}
              </div>

              <span className="text-xs" style={{ color: "var(--color-muted)" }}>{r.packageCount}</span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>{r.fileCount}</span>

              {/* Storage bar */}
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: "var(--color-ink)" }}>{fmt(bytes)}</p>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)", width: 80 }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: "var(--color-accent)" }}
                  />
                </div>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--color-muted)" }}>{pct}% of platform total</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
