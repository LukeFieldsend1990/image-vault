export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { licences, users, scanPackages } from "@/lib/db/schema";
import { sql, eq, inArray } from "drizzle-orm";

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

const STATUS_COLOR: Record<string, string> = {
  PENDING: "#d97706",
  APPROVED: "#166534",
  DENIED: "#991b1b",
  REVOKED: "#6b7280",
  EXPIRED: "#9ca3af",
};

export default async function AdminLicencesPage() {
  await requireAdmin();
  const db = getDb();

  const rows = await db
    .select({
      id: licences.id,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      intendedUse: licences.intendedUse,
      status: licences.status,
      validFrom: licences.validFrom,
      validTo: licences.validTo,
      createdAt: licences.createdAt,
      approvedAt: licences.approvedAt,
      deniedAt: licences.deniedAt,
      deniedReason: licences.deniedReason,
      downloadCount: licences.downloadCount,
      talentId: licences.talentId,
      licenseeId: licences.licenseeId,
      packageId: licences.packageId,
      packageName: scanPackages.name,
    })
    .from(licences)
    .innerJoin(scanPackages, eq(scanPackages.id, licences.packageId))
    .orderBy(sql`${licences.createdAt} desc`)
    .all();

  // Resolve talent + licensee emails
  const userIdSet = new Set<string>();
  for (const r of rows) {
    userIdSet.add(r.talentId);
    userIdSet.add(r.licenseeId);
  }
  const userIds = Array.from(userIdSet);
  const userRows = userIds.length > 0
    ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, userIds)).all()
    : [];
  const emailMap = new Map(userRows.map((u) => [u.id, u.email]));

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Licences</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          {rows.length} licence requests platform-wide
        </p>
      </div>

      <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        {/* Header */}
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[900px]"
          style={{
            gridTemplateColumns: "2fr 1.5fr 1.5fr 1fr 1fr 1fr 1fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Project</span>
          <span>Talent</span>
          <span>Licensee</span>
          <span>Package</span>
          <span>Status</span>
          <span>Downloads</span>
          <span>Requested</span>
        </div>

        {rows.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>No licences yet.</p>
        )}

        {rows.map((r) => (
          <div
            key={r.id}
            className="grid items-start px-5 py-3.5 border-b last:border-0 text-sm min-w-[900px]"
            style={{
              gridTemplateColumns: "2fr 1.5fr 1.5fr 1fr 1fr 1fr 1fr",
              borderColor: "var(--color-border)",
            }}
          >
            {/* Project */}
            <div className="min-w-0">
              <p className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{r.projectName}</p>
              <p className="text-[11px] truncate" style={{ color: "var(--color-muted)" }}>{r.productionCompany}</p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                {ts(r.validFrom)} – {ts(r.validTo)}
              </p>
            </div>

            {/* Talent */}
            <span className="text-xs truncate" style={{ color: "var(--color-text)" }}>
              {emailMap.get(r.talentId) ?? r.talentId.slice(0, 8)}
            </span>

            {/* Licensee */}
            <span className="text-xs truncate" style={{ color: "var(--color-text)" }}>
              {emailMap.get(r.licenseeId) ?? r.licenseeId.slice(0, 8)}
            </span>

            {/* Package */}
            <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
              {r.packageName}
            </span>

            {/* Status */}
            <div>
              <span
                className="inline-flex items-center text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
                style={{
                  background: `${STATUS_COLOR[r.status ?? "PENDING"]}18`,
                  color: STATUS_COLOR[r.status ?? "PENDING"],
                }}
              >
                {r.status}
              </span>
              {r.deniedReason && (
                <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--color-muted)" }}>
                  {r.deniedReason}
                </p>
              )}
            </div>

            {/* Downloads */}
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
              {r.downloadCount ?? 0}
            </span>

            {/* Requested date */}
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
              {ts(r.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
