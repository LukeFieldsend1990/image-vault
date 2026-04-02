export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import {
  bridgeEvents,
  bridgeGrants,
  licences,
  scanPackages,
  users,
} from "@/lib/db/schema";
import { sql, eq, isNull, inArray } from "drizzle-orm";
import Link from "next/link";
import RevokeGrantButton from "./revoke-grant-button";

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function tsTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SEVERITY_COLOR: Record<string, { bg: string; text: string }> = {
  info:     { bg: "rgba(37,99,235,0.1)",  text: "#2563eb" },
  warn:     { bg: "rgba(217,119,6,0.1)",  text: "#d97706" },
  critical: { bg: "rgba(153,27,27,0.12)", text: "#991b1b" },
};

const EVENT_LABELS: Record<string, string> = {
  tamper_detected:  "Tamper detected",
  unexpected_copy:  "Unexpected copy",
  hash_mismatch:    "Hash mismatch",
  lease_expired:    "Lease expired",
  cache_purged:     "Cache purged",
  open_denied:      "Open denied",
};

export default async function AdminBridgePage() {
  await requireAdmin();
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // ── Active grants ─────────────────────────────────────────────────────────
  const activeGrants = await db
    .select({
      id: bridgeGrants.id,
      licenceId: bridgeGrants.licenceId,
      packageId: bridgeGrants.packageId,
      userId: bridgeGrants.userId,
      tool: bridgeGrants.tool,
      deviceId: bridgeGrants.deviceId,
      expiresAt: bridgeGrants.expiresAt,
      offlineUntil: bridgeGrants.offlineUntil,
      createdAt: bridgeGrants.createdAt,
      packageName: scanPackages.name,
    })
    .from(bridgeGrants)
    .innerJoin(scanPackages, eq(scanPackages.id, bridgeGrants.packageId))
    .where(isNull(bridgeGrants.revokedAt))
    .orderBy(sql`${bridgeGrants.createdAt} desc`)
    .all();

  // Filter out expired grants (by licence expiry, not offline grace period)
  const liveGrants = activeGrants.filter((g) => g.expiresAt > now);

  // Resolve user emails for grants
  const grantUserIds = [...new Set(liveGrants.map((g) => g.userId))];
  const grantUsers = grantUserIds.length > 0
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.id, grantUserIds))
        .all()
    : [];
  const grantEmailMap = new Map(grantUsers.map((u) => [u.id, u.email]));

  // ── Recent events (last 100) ──────────────────────────────────────────────
  const events = await db
    .select({
      id: bridgeEvents.id,
      grantId: bridgeEvents.grantId,
      packageId: bridgeEvents.packageId,
      deviceId: bridgeEvents.deviceId,
      userId: bridgeEvents.userId,
      eventType: bridgeEvents.eventType,
      severity: bridgeEvents.severity,
      detail: bridgeEvents.detail,
      createdAt: bridgeEvents.createdAt,
    })
    .from(bridgeEvents)
    .orderBy(sql`${bridgeEvents.createdAt} desc`)
    .limit(100)
    .all();

  // Resolve package names for events
  const eventPackageIds = [...new Set(events.map((e) => e.packageId))];
  const eventPackages = eventPackageIds.length > 0
    ? await db
        .select({ id: scanPackages.id, name: scanPackages.name })
        .from(scanPackages)
        .where(inArray(scanPackages.id, eventPackageIds))
        .all()
    : [];
  const packageNameMap = new Map(eventPackages.map((p) => [p.id, p.name]));

  // Count by severity
  const criticalCount = events.filter((e) => e.severity === "critical").length;
  const warnCount = events.filter((e) => e.severity === "warn").length;

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>CAS Bridge</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Active bridge sessions and integrity event log.
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: "Active sessions", value: liveGrants.length, color: "#166534" },
          { label: "Events (last 100)", value: events.length, color: "var(--color-ink)" },
          { label: "Warnings", value: warnCount, color: "#d97706" },
          { label: "Critical", value: criticalCount, color: "#991b1b" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded border p-4"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <p className="text-2xl font-semibold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Active grants ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
          Active Sessions
        </h2>
        <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          {/* Header */}
          <div
            className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[800px]"
            style={{
              gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 80px",
              color: "var(--color-muted)",
              background: "var(--color-surface)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <span>Package</span>
            <span>Licensee</span>
            <span>Tool</span>
            <span>Issued</span>
            <span>Expires</span>
            <span></span>
          </div>

          {liveGrants.length === 0 && (
            <p className="px-5 py-5 text-sm" style={{ color: "var(--color-muted)" }}>
              No active bridge sessions.
            </p>
          )}

          {liveGrants.map((g) => (
            <div
              key={g.id}
              className="grid items-center px-5 py-3.5 text-sm border-b last:border-0 min-w-[800px]"
              style={{ gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 80px", borderColor: "var(--color-border)" }}
            >
              <div className="min-w-0">
                <p className="font-medium truncate" style={{ color: "var(--color-ink)" }}>
                  {g.packageName}
                </p>
                <p className="text-[10px] truncate font-mono" style={{ color: "var(--color-muted)" }}>
                  {g.id.slice(0, 8)}…
                </p>
              </div>
              <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
                {grantEmailMap.get(g.userId) ?? g.userId.slice(0, 8) + "…"}
              </span>
              <span
                className="inline-flex text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded w-fit"
                style={{ background: "rgba(37,99,235,0.1)", color: "#2563eb" }}
              >
                {g.tool}
              </span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>{ts(g.createdAt)}</span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>{ts(g.expiresAt)}</span>
              <RevokeGrantButton grantId={g.id} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Event log ──────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
          Event Log
        </h2>
        <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          {/* Header */}
          <div
            className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[800px]"
            style={{
              gridTemplateColumns: "1fr 1.5fr 1fr 1fr 2fr",
              color: "var(--color-muted)",
              background: "var(--color-surface)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <span>When</span>
            <span>Package</span>
            <span>Type</span>
            <span>Severity</span>
            <span>Detail</span>
          </div>

          {events.length === 0 && (
            <p className="px-5 py-5 text-sm" style={{ color: "var(--color-muted)" }}>
              No bridge events recorded yet.
            </p>
          )}

          {events.map((e) => {
            const sev = SEVERITY_COLOR[e.severity] ?? SEVERITY_COLOR.warn;
            let detailText = "—";
            if (e.detail) {
              try {
                const parsed = JSON.parse(e.detail) as Record<string, unknown>;
                detailText = Object.entries(parsed)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(", ");
              } catch {
                detailText = e.detail;
              }
            }
            return (
              <div
                key={e.id}
                className="grid items-start px-5 py-3 text-xs border-b last:border-0 min-w-[800px]"
                style={{ gridTemplateColumns: "1fr 1.5fr 1fr 1fr 2fr", borderColor: "var(--color-border)" }}
              >
                <span style={{ color: "var(--color-muted)" }}>{tsTime(e.createdAt)}</span>
                <span className="truncate font-medium" style={{ color: "var(--color-ink)" }}>
                  {packageNameMap.get(e.packageId) ?? e.packageId.slice(0, 8) + "…"}
                </span>
                <span style={{ color: "var(--color-muted)" }}>
                  {EVENT_LABELS[e.eventType] ?? e.eventType}
                </span>
                <span
                  className="inline-flex text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded w-fit"
                  style={{ background: sev.bg, color: sev.text }}
                >
                  {e.severity}
                </span>
                <span className="truncate font-mono text-[10px]" style={{ color: "var(--color-muted)" }}>
                  {detailText}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
