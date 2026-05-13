"use client";

import { useEffect, useState, useCallback } from "react";

interface PublishedPackage {
  packageId: string;
  packageName: string;
}

interface AgentLicence {
  licenceId: string;
  packageId: string | null;
  packageName: string | null;
  talentName: string | null;
  licenceName: string | null;
  validFrom: number;
  validTo: number;
  status: string;
  deliveryMode: string | null;
  productionId: string | null;
}

interface AgentSummary {
  agentId: string;
  displayName: string;
  organisationId: string;
  organisationName: string;

  status: "active" | "revoked" | "expired";
  lastHeartbeatAt: number | null;
  agentOnline: boolean;
  tokenExpiresAt: number | null;
  pendingAction: string | null;
  revokedAt: number | null;
  publishedPackages: PublishedPackage[];
  licences: AgentLicence[];
}

function useTick(intervalMs = 1000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

function timeSince(ts: number | null): string {
  if (!ts) return "never";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function daysUntil(ts: number | null): string {
  if (!ts) return "—";
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "expired";
  if (diff < 86400) return "< 1 day";
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function tokenPct(tokenExpiresAt: number | null): number {
  if (!tokenExpiresAt) return 0;
  const now = Math.floor(Date.now() / 1000);
  const total = 365 * 86400;
  const remaining = tokenExpiresAt - now;
  return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function StatusDot({ online, revoked, pending }: { online: boolean; revoked: boolean; pending: string | null }) {
  if (revoked) {
    return (
      <span className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ background: "#6b7280" }} />
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#6b7280" }}>Revoked</span>
      </span>
    );
  }
  if (pending === "purge") {
    return (
      <span className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: "#c0392b" }} />
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#c0392b" }}>Purging</span>
      </span>
    );
  }
  if (pending === "publish") {
    return (
      <span className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: "#b45309" }} />
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#b45309" }}>Publishing</span>
      </span>
    );
  }
  if (online) {
    return (
      <span className="flex items-center gap-2">
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: "#16a34a" }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#16a34a" }} />
        </span>
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#16a34a" }}>Online</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ background: "#9ca3af" }} />
      <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#9ca3af" }}>Offline</span>
    </span>
  );
}

function AgentCard({ agent, role, onRevoke }: { agent: AgentSummary; role: string; onRevoke: (id: string) => void }) {
  useTick(); // re-render every second for live countdown
  const [revoking, setRevoking] = useState(false);
  const isRevoked = agent.status === "revoked" || agent.revokedAt !== null;
  const pct = tokenPct(agent.tokenExpiresAt);
  const tokenBarColor = pct > 50 ? "#16a34a" : pct > 20 ? "#b45309" : "#c0392b";

  async function handleRevoke() {
    if (!confirm(`Revoke agent "${agent.displayName}"? It will purge files from the render share on next heartbeat.`)) return;
    setRevoking(true);
    try {
      const r = await fetch(`/api/bridge/render-bridge/${agent.agentId}/revoke`, { method: "POST" });
      if (r.ok) onRevoke(agent.agentId);
    } finally {
      setRevoking(false);
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const activeLicences = agent.licences.filter(
    l => l.status === "APPROVED" && l.deliveryMode === "bridge_only" && l.validTo > nowSec
  );

  // For "Published to share": deduplicate packages, tracking whether any bridge-enabled licence covers each
  const packageMap = new Map<string, { name: string; hasBridgeLicence: boolean }>();
  for (const l of agent.licences) {
    if (!l.packageId || !l.packageName) continue;
    const existing = packageMap.get(l.packageId);
    const hasBridge = l.deliveryMode === "bridge_only";
    if (!existing) {
      packageMap.set(l.packageId, { name: l.packageName, hasBridgeLicence: hasBridge });
    } else if (hasBridge) {
      existing.hasBridgeLicence = true;
    }
  }
  const allPackages = [...packageMap.entries()].map(([pkgId, { name, hasBridgeLicence }]) => ({ pkgId, name, hasBridgeLicence }));

  return (
    <div
      className="rounded overflow-hidden flex flex-col"
      style={{
        border: "1px solid var(--color-border)",
        opacity: isRevoked ? 0.7 : 1,
      }}
    >
      {/* Card header — dark band */}
      <div className="px-5 pt-5 pb-4" style={{ background: "#0a0a0a" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold truncate" style={{ color: "#ffffff" }}>
              {agent.displayName}
            </p>
            <p className="mt-0.5 text-xs truncate" style={{ color: "rgba(255,255,255,0.5)" }}>
              {agent.organisationName}
            </p>
          </div>
          <span
            className="flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest"
            style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
          >
            Render Bridge
          </span>
        </div>

        {/* Status row */}
        <div className="mt-4 flex items-center justify-between gap-2">
          <StatusDot online={agent.agentOnline} revoked={isRevoked} pending={agent.pendingAction} />
          <span className="font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            {agent.lastHeartbeatAt ? timeSince(agent.lastHeartbeatAt) : "no heartbeat"}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 divide-y" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>

        {/* Published packages */}
        <div className="px-5 py-4">
          <p className="text-[10px] font-semibold tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>
            Published to share
            {agent.publishedPackages.length > 0 && (
              <span
                className="ml-2 rounded-full px-1.5 py-0.5 text-[9px]"
                style={{ background: "#16a34a18", color: "#16a34a" }}
              >
                {agent.publishedPackages.length}
              </span>
            )}
          </p>
          {allPackages.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>No packages on this licence yet.</p>
          ) : (
            <ul className="space-y-2">
              {allPackages.map(({ pkgId, name: pkgName, hasBridgeLicence }) => {
                const published = agent.publishedPackages.some(p => p.packageId === pkgId);
                const transferring = !published && hasBridgeLicence && agent.agentOnline;
                const pending = !published && hasBridgeLicence && !agent.agentOnline;
                return (
                  <li key={pkgId} className="flex items-center gap-2.5 text-xs">
                    {published ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : transferring ? (
                      <span className="relative flex h-[13px] w-[13px] flex-shrink-0 items-center justify-center">
                        <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full opacity-50" style={{ background: "#b45309" }} />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "#b45309" }} />
                      </span>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0" style={{ color: "var(--color-border)" }}>
                        <circle cx="12" cy="12" r="9" />
                      </svg>
                    )}
                    <span style={{ color: published ? "var(--color-ink)" : transferring ? "var(--color-ink)" : "var(--color-muted)" }}>
                      {pkgName}
                    </span>
                    {published && (
                      <span className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: "#16a34a18", color: "#16a34a" }}>
                        on share
                      </span>
                    )}
                    {transferring && (
                      <span className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: "#b4530918", color: "#b45309" }}>
                        downloading
                      </span>
                    )}
                    {pending && (
                      <span className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: "#9ca3af18", color: "#9ca3af" }}>
                        pending
                      </span>
                    )}
                    {!published && !hasBridgeLicence && (
                      <span className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: "#b4530918", color: "#b45309" }}>
                        no bridge licence
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Licences covered */}
        {role === "licensee" && activeLicences.length > 0 && (
          <div className="px-5 py-4">
            <p className="text-[10px] font-semibold tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>
              Licences covered
            </p>
            <ul className="space-y-3">
              {activeLicences.map(l => (
                <li key={l.licenceId} className="text-xs">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium truncate" style={{ color: "var(--color-ink)" }}>
                      {l.talentName ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 mt-0.5">
                    <span className="truncate" style={{ color: "var(--color-muted)" }}>
                      {l.licenceName ?? "—"}
                      {l.packageName && (
                        <> · {l.packageName}</>
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px]" style={{ color: "var(--color-muted)" }}>
                    {formatDate(l.validFrom)} – {formatDate(l.validTo)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* For talent/rep: show which org has access */}
        {(role === "talent" || role === "rep") && (
          <div className="px-5 py-4">
            <p className="text-[10px] font-semibold tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>
              Facility access
            </p>
            <div className="flex items-center gap-2 text-xs">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)", flexShrink: 0 }}>
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              <span style={{ color: "var(--color-ink)" }}>{agent.organisationName}</span>
              <span style={{ color: "var(--color-muted)" }}>is publishing your data to a render share</span>
            </div>
            {agent.publishedPackages.length > 0 && (
              <p className="mt-2 text-xs" style={{ color: "var(--color-muted)" }}>
                {agent.publishedPackages.length} package{agent.publishedPackages.length !== 1 ? "s" : ""} currently on their share
              </p>
            )}
          </div>
        )}

        {/* Token expiry + agent ID footer */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
              Service token
            </p>
            <span className="text-[10px] font-mono" style={{ color: "var(--color-muted)" }}>
              {agent.tokenExpiresAt ? `${daysUntil(agent.tokenExpiresAt)} remaining` : "—"}
            </span>
          </div>
          {/* Token bar */}
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: tokenBarColor }}
            />
          </div>
          {agent.tokenExpiresAt && (
            <p className="mt-1.5 text-[10px] font-mono" style={{ color: "var(--color-muted)" }}>
              expires {formatDate(agent.tokenExpiresAt)}
            </p>
          )}
          <p className="mt-3 text-[10px] font-mono truncate" style={{ color: "var(--color-border)" }}>
            {agent.agentId}
          </p>
          {!isRevoked && role === "licensee" && (
            <button
              onClick={() => void handleRevoke()}
              disabled={revoking}
              className="mt-3 w-full rounded border px-3 py-1.5 text-xs transition hover:opacity-80 disabled:opacity-40"
              style={{ borderColor: "#c0392b44", color: "#c0392b", background: "#c0392b0a" }}
            >
              {revoking ? "Revoking…" : "Revoke agent"}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

function EmptyState({ role }: { role: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)" }}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      </div>
      <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
        {role === "licensee" ? "No render-bridge agents enrolled" : "No render-bridge access active"}
      </p>
      <p className="mt-1 max-w-xs text-xs" style={{ color: "var(--color-muted)" }}>
        {role === "licensee"
          ? "Enrol a Docker agent on your render farm using a bridge PAT from Settings → Bridge Tokens."
          : "None of your active licences have a render-bridge agent connected."}
      </p>
    </div>
  );
}

export default function BridgeClient({ role }: { role: string }) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/bridge/render-bridge");
      if (!r.ok) return;
      const d = await r.json() as { agents?: AgentSummary[] };
      setAgents(d.agents ?? []);
      setLastRefreshed(Math.floor(Date.now() / 1000));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Auto-refresh every 10s
  useEffect(() => {
    const id = setInterval(() => { void load(); }, 10_000);
    return () => clearInterval(id);
  }, [load]);

  useTick(); // drive the "last refreshed" counter

  const onlineCount = agents.filter(a => a.agentOnline).length;

  const pageTitle = role === "licensee" ? "Render Bridge" : "Bridge Access";
  const pageSubtitle = role === "licensee"
    ? "Automated delivery to your facility's render share"
    : "Render-bridge agents accessing your licensed assets";

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
            {pageTitle}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>{pageSubtitle}</p>
        </div>

        {!loading && agents.length > 0 && (
          <div className="flex items-center gap-4 pt-0.5">
            {/* Summary pills */}
            <div className="flex items-center gap-2">
              {onlineCount > 0 && (
                <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium" style={{ background: "#16a34a18", color: "#16a34a" }}>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: "#16a34a" }} />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "#16a34a" }} />
                  </span>
                  {onlineCount} online
                </span>
              )}
              {agents.length - onlineCount > 0 && (
                <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: "#9ca3af18", color: "#9ca3af" }}>
                  {agents.length - onlineCount} offline
                </span>
              )}
            </div>

            <button
              onClick={() => void load()}
              className="flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs transition"
              style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              {lastRefreshed ? timeSince(lastRefreshed) : "—"}
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="space-y-4">
          {[0, 1].map(i => (
            <div key={i} className="h-56 rounded animate-pulse" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
          ))}
        </div>
      )}

      {!loading && agents.length === 0 && <EmptyState role={role} />}

      {!loading && agents.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
          {agents.map(agent => (
            <AgentCard
              key={agent.agentId}
              agent={agent}
              role={role}
              onRevoke={(id) => setAgents(prev => prev.filter(a => a.agentId !== id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
