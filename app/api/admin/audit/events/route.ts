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
import { desc, sql } from "drizzle-orm";

type EventCategory = "download" | "licence" | "auth" | "bridge" | "vault" | "invite" | "admin";

type AuditEvent = {
  id: string;
  category: EventCategory;
  timestamp: number;
  actor: string | null;
  detail: string;
  meta: string | null;
  severity: "info" | "warn" | "critical";
};

const BRIDGE_EVENT_LABEL: Record<string, string> = {
  tamper_detected: "Tamper detected",
  unexpected_copy: "Unexpected copy",
  hash_mismatch:   "Hash mismatch",
  lease_expired:   "Lease expired",
  cache_purged:    "Cache purged",
  open_denied:     "Open denied",
};

function fmt(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(1) + " KB";
}

function fmtGBP(pence: number | null): string {
  if (!pence) return "";
  return `$${(pence / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

function fmtBridgeDetail(detail: string | null): string | null {
  if (!detail) return null;
  try {
    const d = JSON.parse(detail) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof d.path === "string") parts.push(d.path.split("/").pop() ?? "");
    if (typeof d.expectedSize === "number" && typeof d.actualSize === "number") {
      const delta = d.actualSize - d.expectedSize;
      parts.push(`${delta >= 0 ? "+" : ""}${fmt(delta)} (exp ${fmt(d.expectedSize)})`);
    }
    return parts.filter(Boolean).join(" · ") || null;
  } catch {
    return detail.slice(0, 80);
  }
}

const BASE_LIMIT = 50;
const FILTERED_LIMIT = 500;

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const fromParam    = url.searchParams.get("from") ?? "";
  const toParam      = url.searchParams.get("to") ?? "";
  const usersParam   = url.searchParams.get("users") ?? "";
  const categoryParam = url.searchParams.get("category") ?? "";

  const fromTs = fromParam ? Math.floor(new Date(fromParam + "T00:00:00Z").getTime() / 1000) : null;
  const toTs   = toParam   ? Math.floor(new Date(toParam   + "T23:59:59Z").getTime() / 1000) : null;
  const userEmails = usersParam
    ? usersParam.split(",").map(e => e.trim().toLowerCase()).filter(Boolean)
    : [];

  const hasFilter = !!(fromParam || toParam || usersParam || categoryParam);
  const LIMIT = hasFilter ? FILTERED_LIMIT : BASE_LIMIT;

  const db = getDb();

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
    db.select({
      id: downloadEvents.id,
      startedAt: downloadEvents.startedAt,
      bytesTransferred: downloadEvents.bytesTransferred,
      ip: downloadEvents.ip,
      email: sql<string>`(SELECT email FROM users WHERE id = ${downloadEvents.licenseeId})`,
      filename: sql<string>`(SELECT filename FROM scan_files WHERE id = ${downloadEvents.fileId})`,
      project: sql<string | null>`(SELECT project_name FROM licences WHERE id = ${downloadEvents.licenceId})`,
    }).from(downloadEvents).orderBy(desc(downloadEvents.startedAt)).limit(LIMIT).all(),

    db.select({
      id: bridgeEvents.id,
      createdAt: bridgeEvents.createdAt,
      eventType: bridgeEvents.eventType,
      severity: bridgeEvents.severity,
      detail: bridgeEvents.detail,
      email: sql<string | null>`(SELECT email FROM users WHERE id = ${bridgeEvents.userId})`,
      packageName: sql<string | null>`(SELECT name FROM scan_packages WHERE id = ${bridgeEvents.packageId})`,
    }).from(bridgeEvents).orderBy(desc(bridgeEvents.createdAt)).limit(LIMIT).all(),

    db.select({
      id: bridgeGrants.id,
      createdAt: bridgeGrants.createdAt,
      revokedAt: bridgeGrants.revokedAt,
      tool: bridgeGrants.tool,
      email: sql<string>`(SELECT email FROM users WHERE id = ${bridgeGrants.userId})`,
      project: sql<string | null>`(SELECT project_name FROM licences WHERE id = ${bridgeGrants.licenceId})`,
      packageName: sql<string | null>`(SELECT name FROM scan_packages WHERE id = ${bridgeGrants.packageId})`,
    }).from(bridgeGrants).orderBy(desc(bridgeGrants.createdAt)).limit(LIMIT).all(),

    db.select({
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
    }).from(licences).orderBy(desc(licences.createdAt)).limit(LIMIT).all(),

    db.select({
      id: users.id,
      email: users.email,
      role: users.role,
      createdAt: sql<number>`cast(${users.createdAt} as integer)`,
    }).from(users).orderBy(desc(users.createdAt)).limit(LIMIT).all(),

    db.select({
      id: scanPackages.id,
      name: scanPackages.name,
      status: scanPackages.status,
      createdAt: scanPackages.createdAt,
      deletedAt: scanPackages.deletedAt,
      deletedBy: scanPackages.deletedBy,
      talentEmail: sql<string>`(SELECT email FROM users WHERE id = ${scanPackages.talentId})`,
      deletedByEmail: sql<string | null>`(SELECT email FROM users WHERE id = ${scanPackages.deletedBy})`,
    }).from(scanPackages).orderBy(desc(scanPackages.createdAt)).limit(LIMIT).all(),

    db.select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      usedAt: invites.usedAt,
      createdAt: invites.createdAt,
      inviterEmail: sql<string>`(SELECT email FROM users WHERE id = ${invites.invitedBy})`,
    }).from(invites).orderBy(desc(invites.createdAt)).limit(LIMIT).all(),

    db.select({
      id: passwordResetTokens.id,
      usedAt: passwordResetTokens.usedAt,
      createdAt: passwordResetTokens.createdAt,
      email: sql<string>`(SELECT email FROM users WHERE id = ${passwordResetTokens.userId})`,
    }).from(passwordResetTokens).orderBy(desc(passwordResetTokens.createdAt)).limit(LIMIT).all(),

    db.select({
      id: users.id,
      email: users.email,
      suspendedAt: users.suspendedAt,
    }).from(users).where(sql`${users.suspendedAt} IS NOT NULL`).all(),
  ]);

  const events: AuditEvent[] = [];

  for (const e of dlRows) {
    events.push({
      id: `dl-${e.id}`,
      category: "download",
      timestamp: e.startedAt,
      actor: e.email,
      detail: `Downloaded ${e.filename ?? "file"}${e.project ? ` — ${e.project}` : " (own)"}`,
      meta: [fmt(e.bytesTransferred), e.ip].filter(Boolean).join(" · ") || null,
      severity: "info",
    });
  }

  for (const e of brRows) {
    events.push({
      id: `br-${e.id}`,
      category: "bridge",
      timestamp: e.createdAt,
      actor: e.email,
      detail: `${BRIDGE_EVENT_LABEL[e.eventType] ?? e.eventType}${e.packageName ? ` — ${e.packageName}` : ""}`,
      meta: fmtBridgeDetail(e.detail),
      severity: (e.severity === "critical" ? "critical" : e.severity === "warn" ? "warn" : "info") as AuditEvent["severity"],
    });
  }

  for (const e of grantRows) {
    events.push({
      id: `bg-${e.id}`,
      category: "bridge",
      timestamp: e.createdAt,
      actor: e.email,
      detail: `Grant issued for ${e.tool}${e.project ? ` — ${e.project}` : ""}`,
      meta: e.packageName,
      severity: "info",
    });
    if (e.revokedAt) {
      events.push({
        id: `bg-rev-${e.id}`,
        category: "bridge",
        timestamp: e.revokedAt,
        actor: e.email,
        detail: `Grant revoked${e.project ? ` — ${e.project}` : ""}`,
        meta: e.packageName,
        severity: "warn",
      });
    }
  }

  for (const e of licenceRows) {
    events.push({
      id: `lic-req-${e.id}`,
      category: "licence",
      timestamp: e.createdAt,
      actor: e.licenseeEmail,
      detail: `Licence requested — ${e.projectName} (${e.productionCompany})`,
      meta: e.proposedFee ? fmtGBP(e.proposedFee) : null,
      severity: "info",
    });
    if (e.approvedAt) {
      events.push({
        id: `lic-app-${e.id}`,
        category: "licence",
        timestamp: e.approvedAt,
        actor: e.approverEmail ?? e.talentEmail,
        detail: `Licence approved — ${e.projectName}`,
        meta: e.agreedFee ? fmtGBP(e.agreedFee) : null,
        severity: "info",
      });
    }
    if (e.deniedAt) {
      events.push({
        id: `lic-den-${e.id}`,
        category: "licence",
        timestamp: e.deniedAt,
        actor: e.talentEmail,
        detail: `Licence denied — ${e.projectName}${e.deniedReason ? `: ${e.deniedReason}` : ""}`,
        meta: null,
        severity: "warn",
      });
    }
    if (e.revokedAt) {
      events.push({
        id: `lic-rev-${e.id}`,
        category: "licence",
        timestamp: e.revokedAt,
        actor: e.talentEmail,
        detail: `Licence revoked — ${e.projectName}`,
        meta: null,
        severity: "critical",
      });
    }
  }

  for (const e of signupRows) {
    events.push({
      id: `signup-${e.id}`,
      category: "auth",
      timestamp: e.createdAt,
      actor: e.email,
      detail: `Account created (${e.role})`,
      meta: null,
      severity: "info",
    });
  }

  for (const e of pwResetRows) {
    events.push({
      id: `pwreset-${e.id}`,
      category: "auth",
      timestamp: e.createdAt,
      actor: e.email,
      detail: e.usedAt ? "Password reset completed" : "Password reset requested",
      meta: null,
      severity: "warn",
    });
  }

  for (const e of suspendRows) {
    if (e.suspendedAt) {
      events.push({
        id: `suspend-${e.id}`,
        category: "admin",
        timestamp: e.suspendedAt,
        actor: e.email,
        detail: "Account suspended",
        meta: null,
        severity: "critical",
      });
    }
  }

  for (const e of packageRows) {
    events.push({
      id: `pkg-${e.id}`,
      category: "vault",
      timestamp: e.createdAt,
      actor: e.talentEmail,
      detail: `Package created — ${e.name}`,
      meta: e.status,
      severity: "info",
    });
    if (e.deletedAt) {
      events.push({
        id: `pkg-del-${e.id}`,
        category: "vault",
        timestamp: e.deletedAt,
        actor: e.deletedByEmail ?? "unknown",
        detail: `Package deleted — ${e.name}`,
        meta: null,
        severity: "warn",
      });
    }
  }

  for (const e of inviteRows) {
    events.push({
      id: `inv-${e.id}`,
      category: "invite",
      timestamp: e.createdAt,
      actor: e.inviterEmail,
      detail: `Invite sent to ${e.email} (${e.role})`,
      meta: null,
      severity: "info",
    });
    if (e.usedAt) {
      events.push({
        id: `inv-used-${e.id}`,
        category: "invite",
        timestamp: e.usedAt,
        actor: e.email,
        detail: `Invite accepted (${e.role})`,
        meta: null,
        severity: "info",
      });
    }
  }

  events.sort((a, b) => b.timestamp - a.timestamp);

  let filtered = events;
  if (fromTs !== null) filtered = filtered.filter(e => e.timestamp >= fromTs);
  if (toTs !== null)   filtered = filtered.filter(e => e.timestamp <= toTs);
  if (userEmails.length > 0) {
    filtered = filtered.filter(e => e.actor && userEmails.includes(e.actor.toLowerCase()));
  }
  if (categoryParam) {
    filtered = filtered.filter(e => e.category === categoryParam);
  }

  return NextResponse.json({ events: filtered.slice(0, 1000) });
}
