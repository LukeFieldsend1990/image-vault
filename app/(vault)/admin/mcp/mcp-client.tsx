"use client";

import { useCallback, useEffect, useState } from "react";

interface TokenRow {
  id: string;
  displayName: string;
  scope: "read" | "admin";
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  ownerEmail: string;
}

interface ToolInfo {
  name: string;
  description: string;
  mutating: boolean;
}

interface AuditRow {
  id: string;
  tool: string;
  success: boolean;
  message: string | null;
  userEmail: string;
  createdAt: number;
}

function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const cardStyle = {
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
} as const;

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-xs font-medium tracking-widest uppercase mb-3"
      style={{ color: "var(--color-muted)" }}
    >
      {children}
    </h2>
  );
}

export default function McpClient({ tools, audit }: { tools: ToolInfo[]; audit: AuditRow[] }) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [displayName, setDisplayName] = useState("");
  const [scope, setScope] = useState<"read" | "admin">("read");
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [totpCode, setTotpCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mcp/tokens");
      if (!res.ok) throw new Error("Failed to load tokens");
      const data = (await res.json()) as { tokens: TokenRow[] };
      setTokens(data.tokens);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tokens");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  async function createToken(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setNewToken(null);
    try {
      const res = await fetch("/api/mcp/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, scope, totpCode, expiresInDays }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error ?? "Failed to create token");
      setNewToken(data.token);
      setDisplayName("");
      setTotpCode("");
      void loadTokens();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create token");
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(id: string, name: string) {
    if (!window.confirm(`Revoke MCP token "${name}"? Connected clients will lose access immediately.`)) return;
    const res = await fetch(`/api/mcp/tokens/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Failed to revoke token");
      return;
    }
    void loadTokens();
  }

  async function copyToken() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded p-3 text-sm" style={{ border: "1px solid #c0392b", color: "#c0392b" }}>
          {error}
        </div>
      )}

      {/* Create token */}
      <section>
        <SectionHeader>Create token</SectionHeader>
        <form onSubmit={createToken} className="rounded p-4 space-y-3" style={cardStyle}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm block">
              <span style={{ color: "var(--color-muted)" }}>Name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Claude on my laptop"
                required
                maxLength={80}
                className="mt-1 w-full rounded px-2 py-1.5 text-sm"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
              />
            </label>
            <label className="text-sm block">
              <span style={{ color: "var(--color-muted)" }}>Scope</span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as "read" | "admin")}
                className="mt-1 w-full rounded px-2 py-1.5 text-sm"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
              >
                <option value="read">read — visibility tools only</option>
                <option value="admin">admin — corrective tools (each call still needs 2FA)</option>
              </select>
            </label>
            <label className="text-sm block">
              <span style={{ color: "var(--color-muted)" }}>Expires in (days, max 90)</span>
              <input
                type="number"
                min={1}
                max={90}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(Number(e.target.value))}
                className="mt-1 w-full rounded px-2 py-1.5 text-sm"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
              />
            </label>
            <label className="text-sm block">
              <span style={{ color: "var(--color-muted)" }}>2FA code</span>
              <input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="6-digit code"
                required
                inputMode="numeric"
                pattern="[0-9 ]{6,7}"
                className="mt-1 w-full rounded px-2 py-1.5 text-sm font-mono"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--color-accent)", color: "#fff" }}
          >
            {creating ? "Creating…" : "Create token"}
          </button>
        </form>

        {newToken && (
          <div className="rounded p-4 mt-3" style={{ ...cardStyle, borderColor: "var(--color-accent)" }}>
            <p className="text-sm font-medium mb-2" style={{ color: "var(--color-text)" }}>
              Token created — copy it now, it cannot be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code
                className="text-xs break-all rounded px-2 py-1.5 flex-1"
                style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
              >
                {newToken}
              </code>
              <button
                onClick={() => void copyToken()}
                className="rounded px-3 py-1.5 text-sm shrink-0"
                style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-xs mt-3" style={{ color: "var(--color-muted)" }}>
              Connect from Claude Code:
            </p>
            <code
              className="text-xs block rounded px-2 py-1.5 mt-1 break-all"
              style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
            >
              claude mcp add --transport http image-vault {typeof window !== "undefined" ? window.location.origin : ""}/api/mcp --header &quot;Authorization: Bearer {newToken}&quot;
            </code>
          </div>
        )}
      </section>

      {/* Token list */}
      <section>
        <SectionHeader>Tokens</SectionHeader>
        <div className="rounded overflow-x-auto" style={cardStyle}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "var(--color-muted)" }}>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Scope</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-4 text-center" style={{ color: "var(--color-muted)" }}>Loading…</td></tr>
              ) : tokens.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-4 text-center" style={{ color: "var(--color-muted)" }}>No tokens yet.</td></tr>
              ) : (
                tokens.map((t) => {
                  const status = t.revokedAt ? "revoked" : t.expiresAt <= now ? "expired" : "active";
                  return (
                    <tr key={t.id} style={{ borderTop: "1px solid var(--color-border)", color: "var(--color-text)" }}>
                      <td className="px-3 py-2">{t.displayName}</td>
                      <td className="px-3 py-2">{t.ownerEmail}</td>
                      <td className="px-3 py-2">
                        <span
                          className="rounded px-1.5 py-0.5 text-xs font-medium"
                          style={{
                            background: t.scope === "admin" ? "#c0392b" : "var(--color-border)",
                            color: t.scope === "admin" ? "#fff" : "var(--color-text)",
                          }}
                        >
                          {t.scope}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(t.expiresAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(t.lastUsedAt)}</td>
                      <td className="px-3 py-2">
                        <span style={{ color: status === "active" ? "var(--color-text)" : "var(--color-muted)" }}>
                          {status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {status === "active" && (
                          <button
                            onClick={() => void revokeToken(t.id, t.displayName)}
                            className="text-xs rounded px-2 py-1"
                            style={{ border: "1px solid #c0392b", color: "#c0392b" }}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Tool catalogue */}
      <section>
        <SectionHeader>Registered tools ({tools.length})</SectionHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tools.map((t) => (
            <div key={t.name} className="rounded p-4" style={cardStyle}>
              <div className="flex items-center gap-2 mb-1">
                <code className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{t.name}</code>
                {t.mutating && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide" style={{ background: "#c0392b", color: "#fff" }}>
                    mutating · 2FA
                  </span>
                )}
              </div>
              <p className="text-xs" style={{ color: "var(--color-muted)" }}>{t.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Audit log */}
      <section>
        <SectionHeader>Recent MCP activity</SectionHeader>
        <div className="rounded overflow-x-auto" style={cardStyle}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "var(--color-muted)" }}>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Admin</th>
                <th className="px-3 py-2 font-medium">Tool</th>
                <th className="px-3 py-2 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-4 text-center" style={{ color: "var(--color-muted)" }}>No activity yet.</td></tr>
              ) : (
                audit.map((a) => (
                  <tr key={a.id} style={{ borderTop: "1px solid var(--color-border)", color: "var(--color-text)" }}>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                    <td className="px-3 py-2">{a.userEmail}</td>
                    <td className="px-3 py-2"><code className="text-xs">{a.tool}</code></td>
                    <td className="px-3 py-2">
                      <span style={{ color: a.success ? "var(--color-text)" : "#c0392b" }}>
                        {a.success ? "ok" : "failed"}
                      </span>
                      {a.message && (
                        <span className="ml-2 text-xs" style={{ color: "var(--color-muted)" }}>
                          {a.message.slice(0, 120)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
