"use client";

import { useState } from "react";

interface Agent {
  id: string;
  displayName: string;
  orgName: string | null;
  organisationId: string;
  online: boolean;
  publishedIds: string[];
  pubPkgNames: Record<string, string>;
  pendingAction: string | null;
  lastHeartbeatAt: number | null;
  tokenExpiresAt: number | null;
  revokedAt: number | null;
}

const PENDING_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  purge:          { bg: "rgba(153,27,27,0.12)",   text: "#991b1b", label: "Purge pending"  },
  publish:        { bg: "rgba(37,99,235,0.1)",    text: "#2563eb", label: "Publish pending" },
  "rotate-token": { bg: "rgba(124,58,237,0.1)",   text: "#7c3aed", label: "Token rotation"  },
};

function timeSince(unix: number, now: number): string {
  const s = now - unix;
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function AgentRow({ a, now }: { a: Agent; now: number }) {
  const isRevoked = a.revokedAt !== null;
  const pendingStyle = a.pendingAction ? PENDING_STYLE[a.pendingAction] : null;
  const tokenDaysLeft = a.tokenExpiresAt !== null
    ? Math.max(0, Math.ceil((a.tokenExpiresAt - now) / 86400))
    : null;

  return (
    <div
      className="grid items-center px-5 py-3.5 text-sm border-b last:border-0 min-w-[900px]"
      style={{
        gridTemplateColumns: "2fr 1.5fr 1.5fr 1fr 1fr 1fr",
        borderColor: "var(--color-border)",
        opacity: isRevoked ? 0.5 : 1,
      }}
    >
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

      <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
        {a.orgName ?? a.organisationId.slice(0, 8) + "…"}
      </span>

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
                {a.pubPkgNames[pkgId] ?? pkgId.slice(0, 6) + "…"}
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

      <span className="text-xs" style={{ color: "var(--color-muted)" }}>
        {a.lastHeartbeatAt ? timeSince(a.lastHeartbeatAt, now) : "never"}
      </span>

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
}

const TABLE_HEADER = (
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
);

export function BridgeAgentsTabs({
  activeAgents,
  revokedAgents,
  now,
}: {
  activeAgents: Agent[];
  revokedAgents: Agent[];
  now: number;
}) {
  const [tab, setTab] = useState<"active" | "revoked">("active");

  const agents = tab === "active" ? activeAgents : revokedAgents;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Render Bridge Agents
        </h2>
        <div className="flex gap-1">
          {(["active", "revoked"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1 rounded transition-colors"
              style={
                tab === t
                  ? { background: "var(--color-ink)", color: "var(--color-bg)" }
                  : { background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }
              }
            >
              {t === "active" ? `Active (${activeAgents.length})` : `Revoked (${revokedAgents.length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        {TABLE_HEADER}
        {agents.length === 0 && (
          <p className="px-5 py-5 text-sm" style={{ color: "var(--color-muted)" }}>
            No {tab} render bridge agents.
          </p>
        )}
        {agents.map(a => (
          <AgentRow key={a.id} a={a} now={now} />
        ))}
      </div>
    </div>
  );
}
