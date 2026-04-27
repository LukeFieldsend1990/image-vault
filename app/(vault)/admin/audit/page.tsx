export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
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
import { desc, sql } from "drizzle-orm";
import AuditExportButton from "./export-button";

// ── Types ────────────────────────────────────────────────────────────────────

type EventCategory =
  | "download"
  | "licence"
  | "auth"
  | "bridge"
  | "vault"
  | "invite"
  | "admin";

type AuditEvent = {
  id: string;
  category: EventCategory;
  timestamp: number;
  actor: string | null;
  detail: string;
  meta: string | null;
  severity: "info" | "warn" | "critical";
};

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<
  EventCategory,
  { label: string; color: string }
> = {
  download: { label: "Download", color: "#166534" },
  licence: { label: "Licence", color: "#1d4ed8" },
  auth: { label: "Auth", color: "#7c3aed" },
  bridge: { label: "Bridge", color: "#0891b2" },
  vault: { label: "Vault", color: "#b45309" },
  invite: { label: "Invite", color: "#6d28d9" },
  admin: { label: "Admin", color: "#dc2626" },
};

const SEVERITY_DOT: Record<string, string> = {
  info: "transparent",
  warn: "#d97706",
  critical: "#dc2626",
};

const BRIDGE_EVENT_LABEL: Record<string, string> = {
  tamper_detected: "Tamper detected",
  unexpected_copy: "Unexpected copy",
  hash_mismatch: "Hash mismatch",
  lease_expired: "Lease expired",
  cache_purged: "Cache purged",
  open_denied: "Open denied",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  if (!bytes) return "";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(1) + " KB";
}

function fmtGBP(pence: number | null): string {
  if (!pence) return "";
  return `$${(pence / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function AdminAuditPage() {
  await requireAdmin();
  const db = getDb();

  // Run all queries in parallel — each scoped to last 200 rows for performance
  const LIMIT = 200;

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
    // Downloads
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
      .orderBy(desc(downloadEvents.startedAt))
      .limit(LIMIT)
      .all(),

    // Bridge integrity events
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
      .orderBy(desc(bridgeEvents.createdAt))
      .limit(LIMIT)
      .all(),

    // Bridge grants issued + revoked
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
      .orderBy(desc(bridgeGrants.createdAt))
      .limit(LIMIT)
      .all(),

    // Licence lifecycle: requested, approved, denied, revoked
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
      .orderBy(desc(licences.createdAt))
      .limit(LIMIT)
      .all(),

    // User signups
    db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: sql<number>`cast(${users.createdAt} as integer)`,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(LIMIT)
      .all(),

    // Package creation + deletion
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
      .orderBy(desc(scanPackages.createdAt))
      .limit(LIMIT)
      .all(),

    // Invites sent + accepted
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
      .orderBy(desc(invites.createdAt))
      .limit(LIMIT)
      .all(),

    // Password resets
    db
      .select({
        id: passwordResetTokens.id,
        usedAt: passwordResetTokens.usedAt,
        createdAt: passwordResetTokens.createdAt,
        email: sql<string>`(SELECT email FROM users WHERE id = ${passwordResetTokens.userId})`,
      })
      .from(passwordResetTokens)
      .orderBy(desc(passwordResetTokens.createdAt))
      .limit(LIMIT)
      .all(),

    // Suspended accounts
    db
      .select({
        id: users.id,
        email: users.email,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .where(sql`${users.suspendedAt} IS NOT NULL`)
      .all(),
  ]);

  // ── Build unified event list ─────────────────────────────────────────────

  const events: AuditEvent[] = [];

  // Downloads
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

  // Bridge events
  for (const e of brRows) {
    events.push({
      id: `br-${e.id}`,
      category: "bridge",
      timestamp: e.createdAt,
      actor: e.email,
      detail: `${BRIDGE_EVENT_LABEL[e.eventType] ?? e.eventType}${e.packageName ? ` — ${e.packageName}` : ""}`,
      meta: null,
      severity: (e.severity === "critical" ? "critical" : e.severity === "warn" ? "warn" : "info") as AuditEvent["severity"],
    });
  }

  // Bridge grants
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

  // Licence lifecycle
  for (const e of licenceRows) {
    // Requested
    events.push({
      id: `lic-req-${e.id}`,
      category: "licence",
      timestamp: e.createdAt,
      actor: e.licenseeEmail,
      detail: `Licence requested — ${e.projectName} (${e.productionCompany})`,
      meta: e.proposedFee ? fmtGBP(e.proposedFee) : null,
      severity: "info",
    });
    // Approved
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
    // Denied
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
    // Revoked
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

  // Signups
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

  // Password resets
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

  // Suspensions
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

  // Packages
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

  // Invites
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

  // Sort by time descending, cap at 500
  events.sort((a, b) => b.timestamp - a.timestamp);
  const display = events.slice(0, 500);

  // Category counts
  const counts = new Map<EventCategory, number>();
  for (const e of display) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <p
          className="text-[10px] uppercase tracking-widest font-semibold mb-1"
          style={{ color: "var(--color-accent)" }}
        >
          Admin
        </p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
          Audit Log
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          {display.length} events across the platform.
        </p>

        <AuditExportButton showCategoryFilter />

        {/* Category summary pills */}
        <div className="flex flex-wrap gap-2 mt-3">
          {(Object.entries(CATEGORY_CONFIG) as [EventCategory, { label: string; color: string }][])
            .filter(([cat]) => (counts.get(cat) ?? 0) > 0)
            .map(([cat, cfg]) => (
              <span
                key={cat}
                className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: `${cfg.color}12`, color: cfg.color }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: cfg.color }}
                />
                {counts.get(cat)} {cfg.label}
              </span>
            ))}
        </div>
      </div>

      <p className="text-[10px] text-right sm:hidden mb-1" style={{ color: "var(--color-muted)" }}>
        Scroll for more &rarr;
      </p>
      <div
        className="rounded border overflow-x-auto"
        style={{ borderColor: "var(--color-border)" }}
      >
        {/* Header */}
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[800px]"
          style={{
            gridTemplateColumns: "90px 1.4fr 2.4fr 1fr 1fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Category</span>
          <span>Actor</span>
          <span>Event</span>
          <span>Details</span>
          <span>Date &amp; time</span>
        </div>

        {display.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>
            No events yet.
          </p>
        )}

        {display.map((e) => {
          const cfg = CATEGORY_CONFIG[e.category];
          return (
            <div
              key={e.id}
              className="grid items-center px-5 py-3 border-b last:border-0 text-xs min-w-[800px]"
              style={{
                gridTemplateColumns: "90px 1.4fr 2.4fr 1fr 1fr",
                borderColor: "var(--color-border)",
              }}
            >
              {/* Category badge */}
              <span className="flex items-center gap-1.5">
                {e.severity !== "info" && (
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full flex-shrink-0"
                    style={{ background: SEVERITY_DOT[e.severity] }}
                  />
                )}
                <span
                  className="inline-flex items-center text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
                  style={{ background: `${cfg.color}14`, color: cfg.color }}
                >
                  {cfg.label}
                </span>
              </span>

              {/* Actor */}
              <span className="truncate" style={{ color: "var(--color-text)" }}>
                {e.actor ?? "—"}
              </span>

              {/* Event detail */}
              <span className="truncate" style={{ color: "var(--color-text)" }}>
                {e.detail}
              </span>

              {/* Meta */}
              <span
                className="truncate font-mono text-[11px]"
                style={{ color: "var(--color-muted)" }}
              >
                {e.meta ?? ""}
              </span>

              {/* Timestamp */}
              <span style={{ color: "var(--color-muted)" }}>{ts(e.timestamp)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
