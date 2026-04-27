export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  licences,
  downloadEvents,
  accessWindows,
  accessWindowEvents,
  bridgeEvents,
  scanFiles,
  users,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, sql } from "drizzle-orm";

// ── CSV helpers ───────────────────────────────────────────────────────────────

function csvEscape(val: string): string {
  if (
    val.includes(",") ||
    val.includes('"') ||
    val.includes("\n") ||
    val.includes("\r")
  ) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return (
    fields.map((f) => csvEscape(f == null ? "" : String(f))).join(",") + "\r\n"
  );
}

function isoTs(unix: number | null | undefined): string {
  if (!unix) return "";
  return new Date(unix * 1000).toISOString();
}

function fmtBytes(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(1) + " KB";
}

// ── GET /api/licences/[id]/audit/export ───────────────────────────────────────
// Fulfils contract clause 10.2: full export of download events, access logs,
// and chain-of-custody records for a given licence.
// Access: talent who owns the licence, the licensee, or admin.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const licence = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      licenseeId: licences.licenseeId,
      packageId: licences.packageId,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      createdAt: licences.createdAt,
    })
    .from(licences)
    .where(eq(licences.id, id))
    .get();

  if (!licence) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const adminUser = isAdmin(session.email);
  if (
    !adminUser &&
    session.sub !== licence.talentId &&
    session.sub !== licence.licenseeId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Fetch all relevant records in parallel ────────────────────────────────

  const [dlRows, windowRows, windowEventRows, bridgeRows] = await Promise.all([
    // Download events
    db
      .select({
        id: downloadEvents.id,
        startedAt: downloadEvents.startedAt,
        completedAt: downloadEvents.completedAt,
        ip: downloadEvents.ip,
        userAgent: downloadEvents.userAgent,
        bytesTransferred: downloadEvents.bytesTransferred,
        actorEmail: sql<string>`(SELECT email FROM users WHERE id = ${downloadEvents.licenseeId})`,
        filename: sql<string>`(SELECT filename FROM scan_files WHERE id = ${downloadEvents.fileId})`,
        fileSize: sql<number | null>`(SELECT size_bytes FROM scan_files WHERE id = ${downloadEvents.fileId})`,
      })
      .from(downloadEvents)
      .where(eq(downloadEvents.licenceId, id))
      .orderBy(sql`started_at asc`)
      .all(),

    // Access windows
    db
      .select({
        id: accessWindows.id,
        openedAt: accessWindows.openedAt,
        expiresAt: accessWindows.expiresAt,
        closedAt: accessWindows.closedAt,
        status: accessWindows.status,
        maxDownloads: accessWindows.maxDownloads,
        downloadsUsed: accessWindows.downloadsUsed,
        closeReason: accessWindows.closeReason,
        openedByEmail: sql<string>`(SELECT email FROM users WHERE id = ${accessWindows.openedBy})`,
        licenseeEmail: sql<string>`(SELECT email FROM users WHERE id = ${accessWindows.licenseeId})`,
      })
      .from(accessWindows)
      .where(eq(accessWindows.licenceId, id))
      .orderBy(sql`opened_at asc`)
      .all(),

    // Access window events
    db
      .select({
        id: accessWindowEvents.id,
        windowId: accessWindowEvents.windowId,
        eventType: accessWindowEvents.eventType,
        createdAt: accessWindowEvents.createdAt,
        actorEmail: sql<string | null>`(SELECT email FROM users WHERE id = ${accessWindowEvents.actorId})`,
        metadata: accessWindowEvents.metadata,
      })
      .from(accessWindowEvents)
      .where(
        sql`${accessWindowEvents.windowId} IN (SELECT id FROM access_windows WHERE licence_id = ${id})`
      )
      .orderBy(sql`created_at asc`)
      .all(),

    // Bridge integrity events (scoped to the package linked to this licence)
    licence.packageId
      ? db
          .select({
            id: bridgeEvents.id,
            createdAt: bridgeEvents.createdAt,
            eventType: bridgeEvents.eventType,
            severity: bridgeEvents.severity,
            detail: bridgeEvents.detail,
            actorEmail: sql<string | null>`(SELECT email FROM users WHERE id = ${bridgeEvents.userId})`,
          })
          .from(bridgeEvents)
          .where(eq(bridgeEvents.packageId, licence.packageId))
          .orderBy(sql`created_at asc`)
          .all()
      : Promise.resolve([] as {
          id: string;
          createdAt: number;
          eventType: string;
          severity: string;
          detail: string | null;
          actorEmail: string | null;
        }[]),
  ]);

  // ── Build CSV ─────────────────────────────────────────────────────────────
  // Single flat file with record_type column so all three event classes are
  // included — fulfils Clause 10.2 in one document.

  let csv =
    "record_type,timestamp_utc,completed_at_utc,actor_email,event,file_name," +
    "file_size,bytes_transferred,ip_address,user_agent,window_id,severity,details\r\n";

  for (const e of dlRows) {
    const status = e.completedAt ? "completed" : "incomplete";
    csv += csvRow([
      "download_event",
      isoTs(e.startedAt),
      isoTs(e.completedAt),
      e.actorEmail,
      `File download — ${status}`,
      e.filename,
      fmtBytes(e.fileSize),
      fmtBytes(e.bytesTransferred),
      e.ip,
      e.userAgent,
      "",
      "info",
      "",
    ]);
  }

  for (const w of windowRows) {
    csv += csvRow([
      "access_window",
      isoTs(w.openedAt),
      isoTs(w.closedAt),
      w.openedByEmail,
      `Access window ${w.status} — ${w.downloadsUsed}/${w.maxDownloads} downloads used`,
      "",
      "",
      "",
      "",
      "",
      w.id,
      "info",
      w.closeReason,
    ]);
  }

  for (const e of windowEventRows) {
    csv += csvRow([
      "access_window_event",
      isoTs(e.createdAt),
      "",
      e.actorEmail,
      e.eventType,
      "",
      "",
      "",
      "",
      "",
      e.windowId,
      "info",
      e.metadata,
    ]);
  }

  for (const e of bridgeRows) {
    csv += csvRow([
      "bridge_integrity_event",
      isoTs(e.createdAt),
      "",
      e.actorEmail,
      e.eventType,
      "",
      "",
      "",
      "",
      "",
      "",
      e.severity,
      e.detail,
    ]);
  }

  const slug = licence.projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="licence-audit-${slug}-${id.slice(0, 8)}.csv"`,
    },
  });
}
