"use client";

import { useState } from "react";
import Link from "next/link";

interface BridgeToken {
  id: string;
  displayName: string;
  lastUsedAt: number | null;
  createdAt: number;
  revokedAt: number | null;
}

interface BridgeDevice {
  id: string;
  fingerprint: string;
  displayName: string;
  lastSeenAt: number | null;
  createdAt: number;
}

interface Props {
  role: string;
  canManage: boolean;
  initialTokens: BridgeToken[];
  initialDevices: BridgeDevice[];
  activeGrantsByLicence: { licenceId: string; count: number }[];
}

function ts(unix: number | null): string {
  if (!unix) return "Never";
  const d = new Date(unix * 1000);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function tsRelative(unix: number | null): string {
  if (!unix) return "Never";
  const secs = Math.floor(Date.now() / 1000) - unix;
  if (secs < 60) return "Just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function BridgeSettingsClient({
  role,
  canManage,
  initialTokens,
  initialDevices,
  activeGrantsByLicence,
}: Props) {
  const [tokens, setTokens] = useState<BridgeToken[]>(initialTokens);
  const [devices] = useState<BridgeDevice[]>(initialDevices);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeTokens = tokens.filter((t) => !t.revokedAt);
  const revokedTokens = tokens.filter((t) => t.revokedAt);

  async function createToken() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/bridge/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: newName.trim() }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setError(body.error ?? "Failed to create token");
        return;
      }
      const body = await res.json() as { token: string; displayName: string };
      setCreatedToken(body.token);
      setNewName("");
      // Refresh token list
      const list = await fetch("/api/bridge/tokens");
      if (list.ok) {
        const data = await list.json() as { tokens: BridgeToken[] };
        setTokens(data.tokens);
      }
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(id: string) {
    setRevoking(id);
    try {
      await fetch(`/api/bridge/tokens/${id}`, { method: "DELETE" });
      setTokens((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, revokedAt: Math.floor(Date.now() / 1000) } : t
        )
      );
    } finally {
      setRevoking(null);
    }
  }

  function copyToken() {
    if (!createdToken) return;
    void navigator.clipboard.writeText(createdToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const totalActiveGrants = activeGrantsByLicence.reduce((s, x) => s + x.count, 0);

  return (
    <div className="p-8 max-w-2xl">
      {/* Back link */}
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-xs mb-6"
        style={{ color: "var(--color-muted)" }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back to Settings
      </Link>

      <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
        Bridge
      </p>
      <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--color-ink)" }}>
        CAS Bridge
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-muted)" }}>
        {canManage
          ? "Generate API tokens to connect the CAS Bridge desktop app to your licences."
          : "Monitor active bridge sessions across your licences."}
      </p>

      {/* Vault URL — shown to licensees so they can paste it into the bridge app */}
      {canManage && (
        <div
          className="rounded border p-4 mb-6"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
            Vault URL
          </p>
          <p className="text-xs mb-2" style={{ color: "var(--color-muted)" }}>
            Paste this into the CAS Bridge desktop app along with your token.
          </p>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 rounded px-3 py-2 text-xs font-mono select-all"
              style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
            >
              {process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io"}
            </code>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io")}
              className="shrink-0 rounded border px-3 py-2 text-xs transition hover:opacity-70"
              style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Active grants summary (talent / rep) */}
      {!canManage && totalActiveGrants > 0 && (
        <div
          className="rounded border p-4 mb-6 flex items-start gap-3"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <div
            className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "rgba(37,99,235,0.1)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
              {totalActiveGrants} active bridge {totalActiveGrants === 1 ? "session" : "sessions"}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              Licensees are accessing files via the CAS Bridge desktop app.
            </p>
          </div>
        </div>
      )}
      {!canManage && totalActiveGrants === 0 && (
        <div
          className="rounded border p-4 mb-6"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>No active bridge sessions on your licences.</p>
        </div>
      )}

      {/* ── Token management (licensee / admin only) ── */}
      {canManage && (<>

        {/* New token created banner */}
        {createdToken && (
          <div
            className="rounded border p-4 mb-6"
            style={{ borderColor: "#166534", background: "rgba(22,101,52,0.06)" }}
          >
            <p className="text-xs font-semibold mb-1" style={{ color: "#166534" }}>
              Token created — copy it now. You won&apos;t see it again.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <code
                className="flex-1 text-xs font-mono px-3 py-2 rounded select-all overflow-auto"
                style={{ background: "var(--color-bg)", color: "var(--color-ink)", border: "1px solid var(--color-border)" }}
              >
                {createdToken}
              </code>
              <button
                type="button"
                onClick={copyToken}
                className="shrink-0 flex items-center gap-1.5 rounded border px-3 py-2 text-xs font-medium transition hover:opacity-80"
                style={{ borderColor: "#166534", color: "#166534" }}
              >
                {copied ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setCreatedToken(null)}
                className="shrink-0 text-xs"
                style={{ color: "var(--color-muted)" }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Create token form */}
        <div
          className="rounded border p-5 mb-6"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
            New API Token
          </h2>
          <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
            Tokens are used by the CAS Bridge desktop app. Give each token a descriptive name.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void createToken(); }}
              placeholder="e.g. MacBook Pro — Nuke Studio"
              maxLength={80}
              className="flex-1 rounded border px-3 py-2 text-sm outline-none transition"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-ink)",
              }}
            />
            <button
              type="button"
              onClick={() => void createToken()}
              disabled={creating || !newName.trim()}
              className="shrink-0 flex items-center gap-1.5 rounded border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition hover:opacity-80 disabled:opacity-40"
              style={{ borderColor: "var(--color-ink)", color: "var(--color-ink)" }}
            >
              {creating ? (
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              ) : "Generate"}
            </button>
          </div>
          {error && <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}
        </div>

        {/* Active tokens */}
        <div
          className="rounded border overflow-hidden mb-6"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="px-5 py-3 border-b flex items-center justify-between"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              Active Tokens
            </h2>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded"
              style={{ background: "rgba(22,101,52,0.1)", color: "#166534" }}
            >
              {activeTokens.length}
            </span>
          </div>
          {activeTokens.length === 0 ? (
            <p className="px-5 py-4 text-sm" style={{ color: "var(--color-muted)" }}>
              No active tokens. Generate one above to connect the Bridge app.
            </p>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
              {activeTokens.map((t) => (
                <div key={t.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                      {t.displayName}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                      Created {ts(t.createdAt)} · Last used {tsRelative(t.lastUsedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void revokeToken(t.id)}
                    disabled={revoking === t.id}
                    className="shrink-0 flex items-center gap-1.5 text-xs font-medium transition hover:opacity-70 disabled:opacity-40"
                    style={{ color: "var(--color-danger)" }}
                  >
                    {revoking === t.id ? (
                      <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                      </svg>
                    ) : (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Revoked tokens (collapsed) */}
        {revokedTokens.length > 0 && (
          <details className="mb-6">
            <summary
              className="cursor-pointer select-none text-xs font-medium list-none flex items-center gap-1.5 mb-3"
              style={{ color: "var(--color-muted)" }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="details-chevron">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {revokedTokens.length} revoked token{revokedTokens.length !== 1 ? "s" : ""}
            </summary>
            <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
              {revokedTokens.map((t) => (
                <div
                  key={t.id}
                  className="px-5 py-3 border-b last:border-0 opacity-50"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <p className="text-sm line-through" style={{ color: "var(--color-muted)" }}>{t.displayName}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                    Revoked {t.revokedAt ? ts(t.revokedAt) : ""}
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}
      </>)}

      {/* Registered devices (all roles) */}
      <div
        className="rounded border overflow-hidden"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div
          className="px-5 py-3 border-b flex items-center justify-between"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Registered Devices
          </h2>
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded"
            style={{
              background: devices.length > 0 ? "rgba(22,101,52,0.1)" : "var(--color-border)",
              color: devices.length > 0 ? "#166534" : "var(--color-muted)",
            }}
          >
            {devices.length}
          </span>
        </div>
        {devices.length === 0 ? (
          <p className="px-5 py-4 text-sm" style={{ color: "var(--color-muted)" }}>
            No devices registered yet. Devices are registered automatically when the Bridge app connects.
          </p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {devices.map((d) => (
              <div key={d.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="shrink-0 flex h-8 w-8 items-center justify-center rounded"
                    style={{ background: "var(--color-border)" }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                      {d.displayName}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                      Last seen {tsRelative(d.lastSeenAt)} · Registered {ts(d.createdAt)}
                    </p>
                  </div>
                </div>
                <code className="shrink-0 text-[9px] font-mono" style={{ color: "var(--color-muted)" }}>
                  {d.fingerprint.slice(0, 8)}…
                </code>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
