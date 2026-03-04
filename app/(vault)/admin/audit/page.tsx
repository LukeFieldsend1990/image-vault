export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { downloadEvents } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmt(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(1) + " KB";
}

export default async function AdminAuditPage() {
  await requireAdmin();
  const db = getDb();

  const events = await db
    .select({
      id: downloadEvents.id,
      startedAt: downloadEvents.startedAt,
      completedAt: downloadEvents.completedAt,
      bytesTransferred: downloadEvents.bytesTransferred,
      ip: downloadEvents.ip,
      licenseeEmail: sql<string>`(SELECT email FROM users WHERE id = ${downloadEvents.licenseeId})`,
      filename: sql<string>`(SELECT filename FROM scan_files WHERE id = ${downloadEvents.fileId})`,
      projectName: sql<string | null>`(SELECT project_name FROM licences WHERE id = ${downloadEvents.licenceId})`,
    })
    .from(downloadEvents)
    .orderBy(desc(downloadEvents.startedAt))
    .limit(500)
    .all();

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Audit Log</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Last {events.length} download events across the platform.
        </p>
      </div>

      <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
        {/* Header */}
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3"
          style={{
            gridTemplateColumns: "1.6fr 1.4fr 1.2fr 1fr 1fr 1fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Licensee</span>
          <span>File</span>
          <span>Project</span>
          <span>Size</span>
          <span>IP</span>
          <span>Date &amp; time</span>
        </div>

        {events.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>No download events yet.</p>
        )}

        {events.map((e) => (
          <div
            key={e.id}
            className="grid items-center px-5 py-3 border-b last:border-0 text-xs"
            style={{
              gridTemplateColumns: "1.6fr 1.4fr 1.2fr 1fr 1fr 1fr",
              borderColor: "var(--color-border)",
            }}
          >
            <span className="truncate" style={{ color: "var(--color-text)" }}>{e.licenseeEmail ?? "—"}</span>
            <span className="truncate font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>{e.filename ?? "—"}</span>
            <span className="truncate" style={{ color: "var(--color-muted)" }}>{e.projectName ?? <em>Direct</em>}</span>
            <span style={{ color: "var(--color-muted)" }}>{fmt(e.bytesTransferred)}</span>
            <span className="font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>{e.ip ?? "—"}</span>
            <span style={{ color: "var(--color-muted)" }}>{ts(e.startedAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
