export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { downloadEvents, users, scanFiles, licences } from "@/lib/db/schema";
import { sql, inArray } from "drizzle-orm";

type DownloadStatus = "streamed" | "pending" | "failed";

const STATUS_LABEL: Record<DownloadStatus, string> = {
  streamed: "Streamed",
  pending: "Pending",
  failed: "Failed",
};
const STATUS_COLOR: Record<DownloadStatus, string> = {
  streamed: "#166534",
  pending: "#d97706",
  failed: "#dc2626",
};
const STALE_SECS = 2 * 60 * 60; // 2 hours

function eventStatus(startedAt: number, completedAt: number | null, now: number): DownloadStatus {
  if (completedAt != null) return "streamed";
  return now - startedAt > STALE_SECS ? "failed" : "pending";
}

function fmt(n: number | null): string {
  if (n == null) return "—";
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

export default async function AdminDownloadsPage() {
  await requireAdmin();
  const db = getDb();

  // eslint-disable-next-line react-hooks/purity -- server component, Date.now() is intentional
  const now = Math.floor(Date.now() / 1000);

  const events = await db
    .select({
      id: downloadEvents.id,
      licenceId: downloadEvents.licenceId,
      licenseeId: downloadEvents.licenseeId,
      fileId: downloadEvents.fileId,
      ip: downloadEvents.ip,
      bytesTransferred: downloadEvents.bytesTransferred,
      startedAt: downloadEvents.startedAt,
      completedAt: downloadEvents.completedAt,
    })
    .from(downloadEvents)
    .orderBy(sql`started_at desc`)
    .limit(500)
    .all();

  // Resolve IDs in bulk
  const userIds = [...new Set(events.map((e) => e.licenseeId))];
  const fileIds = [...new Set(events.map((e) => e.fileId))];
  const licenceIds = [...new Set(events.map((e) => e.licenceId).filter(Boolean) as string[])];

  const [userRows, fileRows, licenceRows] = await Promise.all([
    userIds.length > 0
      ? db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, userIds)).all()
      : Promise.resolve([] as { id: string; email: string }[]),
    fileIds.length > 0
      ? db.select({ id: scanFiles.id, filename: scanFiles.filename, sizeBytes: scanFiles.sizeBytes }).from(scanFiles).where(inArray(scanFiles.id, fileIds)).all()
      : Promise.resolve([] as { id: string; filename: string }[]),
    licenceIds.length > 0
      ? db.select({ id: licences.id, projectName: licences.projectName, productionCompany: licences.productionCompany })
          .from(licences).where(inArray(licences.id, licenceIds)).all()
      : Promise.resolve([] as { id: string; projectName: string; productionCompany: string }[]),
  ]);

  const emailMap = new Map(userRows.map((u) => [u.id, u.email]));
  const fileMap = new Map(fileRows.map((f) => [f.id, f]));
  const licenceMap = new Map(licenceRows.map((l) => [l.id, l]));

  const streamed = events.filter((e) => e.completedAt != null).length;
  const pending  = events.filter((e) => e.completedAt == null && now - e.startedAt <= STALE_SECS).length;
  const failed   = events.filter((e) => e.completedAt == null && now - e.startedAt > STALE_SECS).length;

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Download Audit Log</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          {events.length} events (most recent 500) —&nbsp;
          <span style={{ color: STATUS_COLOR.streamed }}>{streamed} streamed</span>
          {pending > 0 && <>, <span style={{ color: STATUS_COLOR.pending }}>{pending} pending</span></>}
          {failed > 0 && <>, <span style={{ color: STATUS_COLOR.failed }}>{failed} failed</span></>}
        </p>
      </div>

      <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        {/* Header */}
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[960px]"
          style={{
            gridTemplateColumns: "1.5fr 1.5fr 1.5fr 100px 1fr 90px 1fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Actor</span>
          <span>File</span>
          <span>Licence / Type</span>
          <span>Status</span>
          <span>Size</span>
          <span>IP</span>
          <span>Date</span>
        </div>

        {events.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>No download events yet.</p>
        )}

        {events.map((e) => {
          const licence = e.licenceId ? licenceMap.get(e.licenceId) : null;
          const isTalentDownload = !e.licenceId;
          const fileInfo = fileMap.get(e.fileId);
          const status = eventStatus(e.startedAt, e.completedAt, now);
          const sizeBytes = fileInfo?.sizeBytes ?? e.bytesTransferred;
          const durationSecs = e.completedAt ? e.completedAt - e.startedAt : null;

          return (
            <div
              key={e.id}
              className="grid items-start px-5 py-3 border-b last:border-0 text-sm min-w-[960px]"
              style={{
                gridTemplateColumns: "1.5fr 1.5fr 1.5fr 100px 1fr 90px 1fr",
                borderColor: "var(--color-border)",
              }}
            >
              {/* Actor */}
              <span className="text-xs truncate" style={{ color: "var(--color-text)" }}>
                {emailMap.get(e.licenseeId) ?? e.licenseeId.slice(0, 10)}
              </span>

              {/* File */}
              <span className="text-xs truncate" style={{ color: "var(--color-text)" }}>
                {fileInfo?.filename ?? e.fileId.slice(0, 8) + "…"}
              </span>

              {/* Licence / Type */}
              <div className="min-w-0">
                {isTalentDownload ? (
                  <span
                    className="inline-flex items-center text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
                    style={{ background: "rgba(100,116,139,0.15)", color: "#64748b" }}
                  >
                    Talent (own)
                  </span>
                ) : (
                  <div>
                    <p className="text-xs truncate font-medium" style={{ color: "var(--color-ink)" }}>
                      {licence?.projectName ?? e.licenceId?.slice(0, 8)}
                    </p>
                    {licence?.productionCompany && (
                      <p className="text-[10px] truncate" style={{ color: "var(--color-muted)" }}>
                        {licence.productionCompany}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Status */}
              <div>
                <span
                  className="inline-flex items-center text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
                  style={{
                    background: `${STATUS_COLOR[status]}18`,
                    color: STATUS_COLOR[status],
                  }}
                >
                  {STATUS_LABEL[status]}
                </span>
                {durationSecs != null && durationSecs > 0 && (
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                    {durationSecs < 60 ? `${durationSecs}s` : `${Math.round(durationSecs / 60)}m`}
                  </p>
                )}
              </div>

              {/* Size */}
              <div>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {fmt(sizeBytes ?? null)}
                </span>
                {sizeBytes != null && e.bytesTransferred != null && e.bytesTransferred < sizeBytes && (
                  <p className="text-[10px] mt-0.5" style={{ color: STATUS_COLOR.failed }}>
                    {fmt(e.bytesTransferred)} received
                  </p>
                )}
              </div>

              {/* IP */}
              <span className="text-xs font-mono" style={{ color: "var(--color-muted)" }}>
                {e.ip ?? "—"}
              </span>

              {/* Date */}
              <div>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {ts(e.startedAt)}
                </span>
                {e.completedAt && e.completedAt !== e.startedAt && (
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                    → {ts(e.completedAt)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
