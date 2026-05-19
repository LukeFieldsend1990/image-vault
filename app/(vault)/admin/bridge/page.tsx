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
import { BridgeAgentsTabs } from "./bridge-agents-tabs";
import { BridgeEventLog } from "./bridge-event-log";

const ONLINE_THRESHOLD_SECS = 60;

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}


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
  const activeAgents  = agents.filter(a => a.revokedAt === null);
  const revokedAgents = agents.filter(a => a.revokedAt !== null);
  const activeAgentCount  = activeAgents.length;
  const onlineAgentCount  = agents.filter(a => a.online).length;

  // Serialise pubPkgNames into each agent for the client component
  const agentsForClient = agents.map(a => ({
    id:               a.id,
    displayName:      a.displayName,
    orgName:          a.orgName,
    organisationId:   a.organisationId,
    online:           a.online,
    publishedIds:     a.publishedIds,
    pendingAction:    a.pendingAction,
    lastHeartbeatAt:  a.lastHeartbeatAt,
    tokenExpiresAt:   a.tokenExpiresAt,
    revokedAt:        a.revokedAt,
    createdAt:        a.createdAt,
    pubPkgNames:      Object.fromEntries(a.publishedIds.map(id => [id, pubPkgNames.get(id) ?? id.slice(0, 6) + "…"])),
  }));
  const activeAgentsForClient  = agentsForClient.filter(a => a.revokedAt === null);
  const revokedAgentsForClient = agentsForClient.filter(a => a.revokedAt !== null);

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
      userId:    bridgeEvents.userId,
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

  const eventUserIds = [...new Set(events.map(e => e.userId).filter((id): id is string => id !== null))];
  const eventUserRows = eventUserIds.length > 0
    ? await db.select({ id: users.id, email: users.email }).from(users)
        .where(inArray(users.id, eventUserIds)).all()
    : [];
  const eventEmailMap = new Map(eventUserRows.map(u => [u.id, u.email]));

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

      {/* ── Render bridge agents (tabbed: active / revoked) ─────────────────── */}
      <BridgeAgentsTabs
        activeAgents={activeAgentsForClient}
        revokedAgents={revokedAgentsForClient}
        now={now}
      />

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
      <BridgeEventLog
        events={events}
        pkgNames={Object.fromEntries(pkgNameMap)}
        agentNames={Object.fromEntries(agentNameMap)}
        userEmails={Object.fromEntries(eventEmailMap)}
      />
    </div>
  );
}
