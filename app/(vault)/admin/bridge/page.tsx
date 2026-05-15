export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import {
  bridgeEvents,
  bridgeGrants,
  organisations,
  renderBridgeAgents,
  scanPackages,
  users,
} from "@/lib/db/schema";
import { sql, eq, isNull, inArray } from "drizzle-orm";
import RevokeGrantButton from "./revoke-grant-button";

const ONLINE_THRESHOLD_SECS = 60;

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function tsTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function timeSince(unix: number, now: number): string {
  const s = now - unix;
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const SEVERITY_COLOR: Record<string, { bg: string; text: string }> = {
  info:     { bg: "rgba(37,99,235,0.1)",  text: "#2563eb" },
  warn:     { bg: "rgba(217,119,6,0.1)",  text: "#d97706" },
  critical: { bg: "rgba(153,27,27,0.12)", text: "#991b1b" },
};

const EVENT_LABELS: Record<string, string> = {
  tamper_detected:         "Tamper detected",
  unexpected_copy:         "Unexpected copy",
  hash_mismatch:           "Hash mismatch",
  lease_expired:           "Lease expired",
  cache_purged:            "Cache purged",
  open_denied:             "Open denied",
  purge_started:           "Purge started",
  purge_partial:           "Purge partial",
  purge_stalled:           "Purge stalled",
  purge_failed:            "Purge failed",
  file_in_use:             "File in use",
  file_removed_from_cache: "File removed from cache",
};

const PENDING_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  purge:          { bg: "rgba(153,27,27,0.12)",   text: "#991b1b", label: "Purge pending"  },
  publish:        { bg: "rgba(37,99,235,0.1)",    text: "#2563eb", label: "Publish pending" },
  "rotate-token": { bg: "rgba(124,58,237,0.1)",   text: "#7c3aed", label: "Token rotation"  },
};

export default async function AdminBridgePage() {
  await requireAdmin();
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // ── Render bridge agents ──────────────────────────────────────────────────
  const rawAgents = await db
    .select({
      id:                   renderBridgeAgents.id,
      displayName:          renderBridgeAgents.displayName,
      organisationId:       renderBridgeAgents.organisationId,
      orgName:              organisations.name,
      status:               renderBridgeAgents.status,
      lastHeartbeatAt:      renderBridgeAgents.lastHeartbeatAt,
      tokenExpiresAt:       renderBridgeAgents.tokenExpiresAt,
      publishedPackagesJson: renderBridgeAgents.publishedPackagesJson,
      pendingAction:        renderBridgeAgents.pendingAction,
      revokedAt:            renderBridgeAgents.revokedAt,
      createdAt:            renderBridgeAgents.createdAt,
    })
    .from(renderBridgeAgents)
    .leftJoin(organisations, eq(organisations.id, renderBridgeAgents.organisationId))
    .orderBy(sql`${renderBridgeAgents.createdAt} desc`)
    .all();

  const agents = rawAgents.map(a => {
    let publishedIds: string[] = [];
    try { publishedIds = JSON.parse(a.publishedPackagesJson) as string[]; } catch { /* empty */ }
    const online = a.revokedAt === null
      && a.lastHeartbeatAt !== null
      && a.lastHeartbeatAt > now - ONLINE_THRESHOLD_SECS;
    return { ...a, publishedIds, online };
  });

  const allPublishedIds = [...new Set(agents.flatMap(a => a.publishedIds))];
  const pubPkgRows = allPublishedIds.length > 0
    ? await db.select({ id: scanPackages.id, name: scanPackages.name })
        .from(scanPackages).where(inArray(scanPackages.id, allPublishedIds)).all()
    : [];
  const pubPkgNames = new Map(pubPkgRows.map(p => [p.id, p.name]));

  const agentNameMap = new Map(agents.map(a => [a.id, a.displayName]));
  const activeAgentCount  = agents.filter(a => a.revokedAt === null).length;
  const onlineAgentCount  = agents.filter(a => a.online).length;

  // ── Old-style CAS grants ──────────────────────────────────────────────────
  const activeGrants = await db
    .select({
      id:          bridgeGrants.id,
      userId:      bridgeGrants.userId,
      tool:        bridgeGrants.tool,
      deviceId:    bridgeGrants.deviceId,
      expiresAt:   bridgeGrants.expiresAt,
      createdAt:   bridgeGrants.createdAt,
      packageName: scanPackages.name,
    })
    .from(bridgeGrants)
    .innerJoin(scanPackages, eq(scanPackages.id, bridgeGrants.packageId))
    .where(isNull(bridgeGrants.revokedAt))
    .orderBy(sql`${bridgeGrants.createdAt} desc`)
    .all();

  const liveGrants = activeGrants.filter(g => g.expiresAt > now);

  const grantUserIds = [...new Set(liveGrants.map(g => g.userId))];
  const grantUsers = grantUserIds.length > 0
    ? await db.select({ id: users.id, email: users.email }).from(users)
        .where(inArray(users.id, grantUserIds)).all()
    : [];
  const grantEmailMap = new Map(grantUsers.map(u => [u.id, u.email]));

  // ── Events (last 100) ────────────────────────────────────────────────────
  const events = await db
    .select({
      id:        bridgeEvents.id,
      grantId:   bridgeEvents.grantId,
      packageId: bridgeEvents.packageId,
      deviceId:  bridgeEvents.deviceId,
      eventType: bridgeEvents.eventType,
      severity:  bridgeEvents.severity,
      detail:    bridgeEvents.detail,
      createdAt: bridgeEvents.createdAt,
    })
    .from(bridgeEvents)
    .orderBy(sql`${bridgeEvents.createdAt} desc`)
    .limit(100)
    .all();

  const eventPkgIds = [...new Set(events.map(e => e.packageId))];
  const eventPkgRows = eventPkgIds.length > 0
    ? await db.select({ id: scanPackages.id, name: scanPackages.name })
        .from(scanPackages).where(inArray(scanPackages.id, eventPkgIds)).all()
    : [];
  const pkgNameMap = new Map(eventPkgRows.map(p => [p.id, p.name]));

  const criticalCount = events.filter(e => e.severity === "critical").length;
  const warnCount     = events.filter(e => e.severity === "warn").length;

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Bridge</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Render bridge agents, CAS sessions, and integrity event log.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">
        {[
          { label: "Render agents",    value: activeAgentCount,  color: "#166534" },
          { label: "Online now",       value: onlineAgentCount,  color: onlineAgentCount > 0 ? "#16a34a" : "var(--color-muted)" },
          { label: "CAS sessions",     value: liveGrants.length, color: "#2563eb" },
          { label: "Events (last 100)",value: events.length,     color: "var(--color-ink)" },
          { label: "Warnings",         value: warnCount,         color: "#d97706" },
          { label: "Critical",         value: criticalCount,     color: "#991b1b" },
        ].map(s => (
          <div key={s.label} className="rounded border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <p className="text-2xl font-semibold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Render bridge agents ─────────────────────────────────────────────── */}
      <div className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
          Render Bridge Agents
        </h2>
        <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          <div
            className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[900px]"
            style={{
              gridTemplateColumns: "2fr 1.5fr 1.5fr 1fr 1fr 1fr",
              color: "var(--color-muted)",
              background: "var(--color-surface)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <span>Agent</span>
            <span>Organisation</span>
            <span>Published</span>
            <span>Pending</span>
            <span>Last seen</span>
            <span>Token</span>
          </div>

          {agents.length === 0 && (
            <p className="px-5 py-5 text-sm" style={{ color: "var(--color-muted)" }}>
              No render bridge agents enrolled.
            </p>
          )}

          {agents.map(a => {
            const isRevoked = a.revokedAt !== null;
            const pendingStyle = a.pendingAction ? PENDING_STYLE[a.pendingAction] : null;
            const tokenDaysLeft = a.tokenExpiresAt !== null
              ? Math.max(0, Math.ceil((a.tokenExpiresAt - now) / 86400))
              : null;

            return (
              <div
                key={a.id}
                className="grid items-center px-5 py-3.5 text-sm border-b last:border-0 min-w-[900px]"
                style={{
                  gridTemplateColumns: "2fr 1.5fr 1.5fr 1fr 1fr 1fr",
                  borderColor: "var(--color-border)",
                  opacity: isRevoked ? 0.5 : 1,
                }}
              >
                {/* Agent name + status dot */}
                <div className="flex items-center gap-2 min-w-0">
                  {isRevoked ? (
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#991b1b" }} />
                  ) : a.online ? (
                    <span className="relative flex h-2 w-2 flex-shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: "#16a34a" }} />
                      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#16a34a" }} />
                    </span>
                  ) : (
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "var(--color-border)" }} />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{a.displayName}</p>
                    <p className="text-[10px] font-mono" style={{ color: "var(--color-muted)" }}>{a.id.slice(0, 8)}…</p>
                  </div>
                </div>

                {/* Organisation */}
                <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
                  {a.orgName ?? a.organisationId.slice(0, 8) + "…"}
                </span>

                {/* Published packages */}
                <div className="flex flex-wrap gap-1">
                  {a.publishedIds.length === 0 ? (
                    <span className="text-xs" style={{ color: "var(--color-muted)" }}>—</span>
                  ) : (
                    <>
                      {a.publishedIds.slice(0, 2).map(pkgId => (
                        <span
                          key={pkgId}
                          className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: "#16a34a18", color: "#16a34a" }}
                        >
                          {pubPkgNames.get(pkgId) ?? pkgId.slice(0, 6) + "…"}
                        </span>
                      ))}
                      {a.publishedIds.length > 2 && (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded"
                          style={{ background: "var(--color-border)", color: "var(--color-muted)" }}
                        >
                          +{a.publishedIds.length - 2}
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* Pending action */}
                <span>
                  {pendingStyle ? (
                    <span
                      className="text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
                      style={{ background: pendingStyle.bg, color: pendingStyle.text }}
                    >
                      {pendingStyle.label}
                    </span>
                  ) : (
                    <span className="text-xs" style={{ color: "var(--color-muted)" }}>—</span>
                  )}
                </span>

                {/* Last heartbeat */}
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {a.lastHeartbeatAt ? timeSince(a.lastHeartbeatAt, now) : "never"}
                </span>

                {/* Token expiry */}
                <span
                  className="text-xs"
                  style={{ color: isRevoked ? "var(--color-muted)" : tokenDaysLeft !== null && tokenDaysLeft < 30 ? "#d97706" : "var(--color-muted)" }}
                >
                  {isRevoked
                    ? "revoked"
                    : tokenDaysLeft !== null
                    ? `${tokenDaysLeft}d`
                    : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CAS bridge sessions (old-style grants) ───────────────────────────── */}
      <div className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
          CAS Bridge Sessions
        </h2>
        <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
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
            <span />
          </div>

          {liveGrants.length === 0 && (
            <p className="px-5 py-5 text-sm" style={{ color: "var(--color-muted)" }}>
              No active CAS sessions.
            </p>
          )}

          {liveGrants.map(g => (
            <div
              key={g.id}
              className="grid items-center px-5 py-3.5 text-sm border-b last:border-0 min-w-[800px]"
              style={{ gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 80px", borderColor: "var(--color-border)" }}
            >
              <div className="min-w-0">
                <p className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{g.packageName}</p>
                <p className="text-[10px] font-mono" style={{ color: "var(--color-muted)" }}>{g.id.slice(0, 8)}…</p>
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

      {/* ── Event log ────────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
          Event Log
        </h2>
        <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          <div
            className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[960px]"
            style={{
              gridTemplateColumns: "1fr 1.5fr 1.2fr 1fr 1fr 2fr",
              color: "var(--color-muted)",
              background: "var(--color-surface)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <span>When</span>
            <span>Package</span>
            <span>Source</span>
            <span>Type</span>
            <span>Severity</span>
            <span>Detail</span>
          </div>

          {events.length === 0 && (
            <p className="px-5 py-5 text-sm" style={{ color: "var(--color-muted)" }}>
              No bridge events recorded yet.
            </p>
          )}

          {events.map(e => {
            const sev = SEVERITY_COLOR[e.severity] ?? SEVERITY_COLOR.warn;
            let detailText = "—";
            if (e.detail) {
              try {
                const parsed = JSON.parse(e.detail) as Record<string, unknown>;
                detailText = Object.entries(parsed).map(([k, v]) => `${k}: ${String(v)}`).join(", ");
              } catch {
                detailText = e.detail;
              }
            }
            const agentName = agentNameMap.get(e.deviceId);
            const isRenderBridge = agentName !== undefined;

            return (
              <div
                key={e.id}
                className="grid items-start px-5 py-3 text-xs border-b last:border-0 min-w-[960px]"
                style={{ gridTemplateColumns: "1fr 1.5fr 1.2fr 1fr 1fr 2fr", borderColor: "var(--color-border)" }}
              >
                <span style={{ color: "var(--color-muted)" }}>{tsTime(e.createdAt)}</span>

                <span className="truncate font-medium" style={{ color: "var(--color-ink)" }}>
                  {pkgNameMap.get(e.packageId) ?? e.packageId.slice(0, 8) + "…"}
                </span>

                {/* Source: render bridge agent, CAS grant, or raw device ID */}
                <span>
                  {isRenderBridge ? (
                    <span
                      className="inline-flex text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "#16a34a18", color: "#16a34a" }}
                    >
                      {agentName}
                    </span>
                  ) : e.grantId ? (
                    <span
                      className="inline-flex text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(37,99,235,0.1)", color: "#2563eb" }}
                    >
                      CAS · {e.grantId.slice(0, 6)}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px]" style={{ color: "var(--color-muted)" }}>
                      {e.deviceId.slice(0, 8)}…
                    </span>
                  )}
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
