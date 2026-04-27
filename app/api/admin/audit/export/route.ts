export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  downloadEvents,
  bridgeEvents,
  bridgeGrants,
  users,
  licences,
  scanPackages,
  invites,
  passwordResetTokens,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { desc, sql, and, gte, lte } from "drizzle-orm";

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

function isoTs(unix: number): string {
  return new Date(unix * 1000).toISOString();
}

function fmt(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(1) + " KB";
}

const BRIDGE_EVENT_LABEL: Record<string, string> = {
  tamper_detected: "Tamper detected",
  unexpected_copy: "Unexpected copy",
  hash_mismatch: "Hash mismatch",
  lease_expired: "Lease expired",
  cache_purged: "Cache purged",
  open_denied: "Open denied",
  purge_started: "Purge started",
  purge_partial: "Purge partial",
  file_in_use: "File in use",
  purge_stalled: "Purge stalled",
  purge_failed: "Purge failed",
};

// ── GET /api/admin/audit/export ───────────────────────────────────────────────
// Query params:
//   from     — ISO date string (YYYY-MM-DD), start of day UTC
//   to       — ISO date string (YYYY-MM-DD), end of day UTC
//   users    — comma-separated email addresses to filter by actor
//   category — single category filter (download|licence|auth|bridge|vault|invite|admin)

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const usersParam = searchParams.get("users");
  const categoryFilter = searchParams.get("category") ?? "";

  const fromTs = from ? Math.floor(new Date(from + "T00:00:00Z").getTime() / 1000) : 0;
  const toTs = to
    ? Math.floor(new Date(to + "T23:59:59Z").getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const filterEmails = usersParam
    ? new Set(
        usersParam
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      )
    : null;

  const db = getDb();
  const LIMIT = 5000;

  type AuditEvent = {
    timestamp: number;
    category: string;
    severity: string;
    actor: string | null;
    event: string;
    details: string | null;
  };

  const events: AuditEvent[] = [];

  const [
    dlRows,
    brRows,
    grantRows,
    licenceRows,
    signupRows,
    packageRows,
    inviteRows,
    pwResetRows,
    suspendRows,
  ] = await Promise.all([
    db
      .select({
        id: downloadEvents.id,
        startedAt: downloadEvents.startedAt,
        bytesTransferred: downloadEvents.bytesTransferred,
        ip: downloadEvents.ip,
        email: sql<string>`(SELECT email FROM users WHERE id = ${downloadEvents.licenseeId})`,
        filename: sql<string>`(SELECT filename FROM scan_files WHERE id = ${downloadEvents.fileId})`,
        project: sql<string | null>`(SELECT project_name FROM licences WHERE id = ${downloadEvents.licenceId})`,
      })
      .from(downloadEvents)
      .where(
        and(
          gte(downloadEvents.startedAt, fromTs),
          lte(downloadEvents.startedAt, toTs)
        )
      )
      .orderBy(desc(downloadEvents.startedAt))
      .limit(LIMIT)
      .all(),

    db
      .select({
        id: bridgeEvents.id,
        createdAt: bridgeEvents.createdAt,
        eventType: bridgeEvents.eventType,
        severity: bridgeEvents.severity,
        detail: bridgeEvents.detail,
        email: sql<string | null>`(SELECT email FROM users WHERE id = ${bridgeEvents.userId})`,
        packageName: sql<string | null>`(SELECT name FROM scan_packages WHERE id = ${bridgeEvents.packageId})`,
      })
      .from(bridgeEvents)
      .where(
        and(
          gte(bridgeEvents.createdAt, fromTs),
          lte(bridgeEvents.createdAt, toTs)
        )
      )
      .orderBy(desc(bridgeEvents.createdAt))
      .limit(LIMIT)
      .all(),

    db
      .select({
        id: bridgeGrants.id,
        createdAt: bridgeGrants.createdAt,
        revokedAt: bridgeGrants.revokedAt,
        tool: bridgeGrants.tool,
        email: sql<string>`(SELECT email FROM users WHERE id = ${bridgeGrants.userId})`,
        project: sql<string | null>`(SELECT project_name FROM licences WHERE id = ${bridgeGrants.licenceId})`,
        packageName: sql<string | null>`(SELECT name FROM scan_packages WHERE id = ${bridgeGrants.packageId})`,
      })
      .from(bridgeGrants)
      .where(
        and(
          gte(bridgeGrants.createdAt, fromTs),
          lte(bridgeGrants.createdAt, toTs)
        )
      )
      .orderBy(desc(bridgeGrants.createdAt))
      .limit(LIMIT)
      .all(),

    db
      .select({
        id: licences.id,
        status: licences.status,
        projectName: licences.projectName,
        productionCompany: licences.productionCompany,
        agreedFee: licences.agreedFee,
        proposedFee: licences.proposedFee,
        deniedReason: licences.deniedReason,
        createdAt: licences.createdAt,
        approvedAt: licences.approvedAt,
        deniedAt: licences.deniedAt,
        revokedAt: licences.revokedAt,
        talentEmail: sql<string>`(SELECT email FROM users WHERE id = ${licences.talentId})`,
        licenseeEmail: sql<string>`(SELECT email FROM users WHERE id = ${licences.licenseeId})`,
        approverEmail: sql<string | null>`(SELECT email FROM users WHERE id = ${licences.approvedBy})`,
      })
      .from(licences)
      .where(
        and(
          gte(licences.createdAt, fromTs),
          lte(licences.createdAt, toTs)
        )
      )
      .orderBy(desc(licences.createdAt))
      .limit(LIMIT)
      .all(),

    db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: sql<number>`cast(${users.createdAt} as integer)`,
      })
      .from(users)
      .where(
        sql`cast(${users.createdAt} as integer) >= ${fromTs} AND cast(${users.createdAt} as integer) <= ${toTs}`
      )
      .orderBy(desc(users.createdAt))
      .limit(LIMIT)
      .all(),

    db
      .select({
        id: scanPackages.id,
        name: scanPackages.name,
        status: scanPackages.status,
        createdAt: scanPackages.createdAt,
        deletedAt: scanPackages.deletedAt,
        deletedBy: scanPackages.deletedBy,
        talentEmail: sql<string>`(SELECT email FROM users WHERE id = ${scanPackages.talentId})`,
        deletedByEmail: sql<string | null>`(SELECT email FROM users WHERE id = ${scanPackages.deletedBy})`,
      })
      .from(scanPackages)
      .where(
        and(
          gte(scanPackages.createdAt, fromTs),
          lte(scanPackages.createdAt, toTs)
        )
      )
      .orderBy(desc(scanPackages.createdAt))
      .limit(LIMIT)
      .all(),

    db
      .select({
        id: invites.id,
        email: invites.email,
        role: invites.role,
        usedAt: invites.usedAt,
        createdAt: invites.createdAt,
        inviterEmail: sql<string>`(SELECT email FROM users WHERE id = ${invites.invitedBy})`,
      })
      .from(invites)
      .where(
        and(
          gte(invites.createdAt, fromTs),
          lte(invites.createdAt, toTs)
        )
      )
      .orderBy(desc(invites.createdAt))
      .limit(LIMIT)
      .all(),

    db
      .select({
        id: passwordResetTokens.id,
        usedAt: passwordResetTokens.usedAt,
        createdAt: passwordResetTokens.createdAt,
        email: sql<string>`(SELECT email FROM users WHERE id = ${passwordResetTokens.userId})`,
      })
      .from(passwordResetTokens)
      .where(
        and(
          gte(passwordResetTokens.createdAt, fromTs),
          lte(passwordResetTokens.createdAt, toTs)
        )
      )
      .orderBy(desc(passwordResetTokens.createdAt))
      .limit(LIMIT)
      .all(),

    db
      .select({
        id: users.id,
        email: users.email,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .where(
        sql`${users.suspendedAt} IS NOT NULL AND ${users.suspendedAt} >= ${fromTs} AND ${users.suspendedAt} <= ${toTs}`
      )
      .all(),
  ]);

  // ── Build unified events ──────────────────────────────────────────────────

  for (const e of dlRows) {
    events.push({
      timestamp: e.startedAt,
      category: "download",
      severity: "info",
      actor: e.email,
      event: `Downloaded ${e.filename ?? "file"}${e.project ? ` — ${e.project}` : " (own)"}`,
      details: [fmt(e.bytesTransferred), e.ip].filter(Boolean).join(" · ") || null,
    });
  }

  for (const e of brRows) {
    events.push({
      timestamp: e.createdAt,
      category: "bridge",
      severity: e.severity === "critical" ? "critical" : e.severity === "warn" ? "warn" : "info",
      actor: e.email ?? null,
      event: `${BRIDGE_EVENT_LABEL[e.eventType] ?? e.eventType}${e.packageName ? ` — ${e.packageName}` : ""}`,
      details: null,
    });
  }

  for (const e of grantRows) {
    events.push({
      timestamp: e.createdAt,
      category: "bridge",
      severity: "info",
      actor: e.email,
      event: `Grant issued for ${e.tool}${e.project ? ` — ${e.project}` : ""}`,
      details: e.packageName,
    });
    if (e.revokedAt && e.revokedAt >= fromTs && e.revokedAt <= toTs) {
      events.push({
        timestamp: e.revokedAt,
        category: "bridge",
        severity: "warn",
        actor: e.email,
        event: `Grant revoked${e.project ? ` — ${e.project}` : ""}`,
        details: e.packageName,
      });
    }
  }

  for (const e of licenceRows) {
    events.push({
      timestamp: e.createdAt,
      category: "licence",
      severity: "info",
      actor: e.licenseeEmail,
      event: `Licence requested — ${e.projectName} (${e.productionCompany})`,
      details: null,
    });
    if (e.approvedAt && e.approvedAt >= fromTs && e.approvedAt <= toTs) {
      events.push({
        timestamp: e.approvedAt,
        category: "licence",
        severity: "info",
        actor: e.approverEmail ?? e.talentEmail,
        event: `Licence approved — ${e.projectName}`,
        details: null,
      });
    }
    if (e.deniedAt && e.deniedAt >= fromTs && e.deniedAt <= toTs) {
      events.push({
        timestamp: e.deniedAt,
        category: "licence",
        severity: "warn",
        actor: e.talentEmail,
        event: `Licence denied — ${e.projectName}${e.deniedReason ? `: ${e.deniedReason}` : ""}`,
        details: null,
      });
    }
    if (e.revokedAt && e.revokedAt >= fromTs && e.revokedAt <= toTs) {
      events.push({
        timestamp: e.revokedAt,
        category: "licence",
        severity: "critical",
        actor: e.talentEmail,
        event: `Licence revoked — ${e.projectName}`,
        details: null,
      });
    }
  }

  for (const e of signupRows) {
    events.push({
      timestamp: e.createdAt,
      category: "auth",
      severity: "info",
      actor: e.email,
      event: `Account created (${e.role})`,
      details: null,
    });
  }

  for (const e of pwResetRows) {
    events.push({
      timestamp: e.createdAt,
      category: "auth",
      severity: "warn",
      actor: e.email,
      event: e.usedAt ? "Password reset completed" : "Password reset requested",
      details: null,
    });
  }

  for (const e of suspendRows) {
    if (e.suspendedAt) {
      events.push({
        timestamp: e.suspendedAt,
        category: "admin",
        severity: "critical",
        actor: e.email,
        event: "Account suspended",
        details: null,
      });
    }
  }

  for (const e of packageRows) {
    events.push({
      timestamp: e.createdAt,
      category: "vault",
      severity: "info",
      actor: e.talentEmail,
      event: `Package created — ${e.name}`,
      details: e.status,
    });
    if (e.deletedAt && e.deletedAt >= fromTs && e.deletedAt <= toTs) {
      events.push({
        timestamp: e.deletedAt,
        category: "vault",
        severity: "warn",
        actor: e.deletedByEmail ?? "unknown",
        event: `Package deleted — ${e.name}`,
        details: null,
      });
    }
  }

  for (const e of inviteRows) {
    events.push({
      timestamp: e.createdAt,
      category: "invite",
      severity: "info",
      actor: e.inviterEmail,
      event: `Invite sent to ${e.email} (${e.role})`,
      details: null,
    });
    if (e.usedAt && e.usedAt >= fromTs && e.usedAt <= toTs) {
      events.push({
        timestamp: e.usedAt,
        category: "invite",
        severity: "info",
        actor: e.email,
        event: `Invite accepted (${e.role})`,
        details: null,
      });
    }
  }

  // ── Apply filters ─────────────────────────────────────────────────────────

  let filtered = events.sort((a, b) => b.timestamp - a.timestamp);

  if (filterEmails) {
    filtered = filtered.filter((e) =>
      e.actor ? filterEmails.has(e.actor.toLowerCase()) : false
    );
  }

  if (categoryFilter) {
    filtered = filtered.filter((e) => e.category === categoryFilter);
  }

  // ── Build CSV ─────────────────────────────────────────────────────────────

  let csv =
    "timestamp_utc,category,severity,actor,event,details\r\n";

  for (const e of filtered) {
    csv += csvRow([
      isoTs(e.timestamp),
      e.category,
      e.severity,
      e.actor,
      e.event,
      e.details,
    ]);
  }

  const dateLabel = from && to
    ? `${from}_to_${to}`
    : from
    ? `from_${from}`
    : to
    ? `to_${to}`
    : "all";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${dateLabel}.csv"`,
    },
  });
}
