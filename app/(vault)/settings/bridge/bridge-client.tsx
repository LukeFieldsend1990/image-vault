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

interface ConnectionOrg {
  orgId: string;
  orgName: string;
  productions: { id: string; name: string }[];
}

interface UnlinkedLicence {
  id: string;
  projectName: string;
  packageName: string | null;
}

interface Props {
  role: string;
  canManage: boolean;
  initialTokens: BridgeToken[];
  initialDevices: BridgeDevice[];
  activeGrantsByLicence: { licenceId: string; count: number }[];
  connectionIds: ConnectionOrg[];
  unlinkedLicences: UnlinkedLicence[];
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
  connectionIds,
  unlinkedLicences,
}: Props) {
  const [tokens, setTokens] = useState<BridgeToken[]>(initialTokens);
  const [devices] = useState<BridgeDevice[]>(initialDevices);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Link production state
  const [remainingUnlinked, setRemainingUnlinked] = useState<UnlinkedLicence[]>(unlinkedLicences);
  const [linkingLicenceId, setLinkingLicenceId] = useState<string | null>(null);
  const [newProdName, setNewProdName] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState(connectionIds[0]?.orgId ?? "");
  const [linkingBusy, setLinkingBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

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

  function copyId(value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopiedId(value);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  async function createAndLinkProduction(licenceId: string) {
    if (!newProdName.trim() || !selectedOrgId) return;
    setLinkingBusy(true);
    setLinkError(null);
    try {
      // Create the production
      const prodRes = await fetch("/api/productions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProdName.trim(), organisationId: selectedOrgId }),
      });
      if (!prodRes.ok) {
        const body = await prodRes.json() as { error?: string };
        setLinkError(body.error ?? "Failed to create production");
        return;
      }
      const { id: productionId } = await prodRes.json() as { id: string };

      // Link it to the licence
      const linkRes = await fetch(`/api/licences/${licenceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productionId, organisationId: selectedOrgId }),
      });
      if (!linkRes.ok) {
        const body = await linkRes.json() as { error?: string };
        setLinkError(body.error ?? "Failed to link production");
        return;
      }

      setRemainingUnlinked(prev => prev.filter(l => l.id !== licenceId));
      setLinkingLicenceId(null);
      setNewProdName("");
    } catch {
      setLinkError("Network error");
    } finally {
      setLinkingBusy(false);
    }
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

      {/* Connection IDs — org and production IDs needed for Docker bridge registration */}
      {canManage && connectionIds.length > 0 && (
        <div
          className="rounded border p-4 mb-6"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
            Connection IDs
          </p>
          <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
            Pass these as <code className="font-mono text-[11px]">organisationId</code> and <code className="font-mono text-[11px]">projectId</code> when registering the bridge agent.
          </p>
          <div className="flex flex-col gap-4">
            {connectionIds.map((org) => (
              <div key={org.orgId}>
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
                  {org.orgName}
                </p>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs w-28 shrink-0" style={{ color: "var(--color-muted)" }}>organisationId</span>
                  <code
                    className="flex-1 rounded px-2.5 py-1.5 text-xs font-mono select-all truncate"
                    style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
                  >
                    {org.orgId}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyId(org.orgId)}
                    className="shrink-0 rounded border px-2.5 py-1.5 text-xs transition hover:opacity-70"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
                  >
                    {copiedId === org.orgId ? "Copied" : "Copy"}
                  </button>
                </div>
                {org.productions.length === 0 ? (
                  <p className="text-xs pl-28" style={{ color: "var(--color-muted)" }}>No productions linked to this organisation.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {org.productions.map((prod) => (
                      <div key={prod.id} className="flex items-center gap-2">
                        <span className="text-xs w-28 shrink-0 truncate" style={{ color: "var(--color-muted)" }}>
                          {prod.name}
                        </span>
                        <code
                          className="flex-1 rounded px-2.5 py-1.5 text-xs font-mono select-all truncate"
                          style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
                        >
                          {prod.id}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyId(prod.id)}
                          className="shrink-0 rounded border px-2.5 py-1.5 text-xs transition hover:opacity-70"
                          style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
                        >
                          {copiedId === prod.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Licences without a production — let licensees create + link a production */}
      {canManage && remainingUnlinked.length > 0 && (
        <div
          className="rounded border p-4 mb-6"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
            Licences without a production
          </p>
          <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
            These licences have no production linked. Create a production to get a <code className="font-mono text-[11px]">projectId</code> for bridge registration.
          </p>
          <div className="flex flex-col gap-3">
            {remainingUnlinked.map((lic) => (
              <div key={lic.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                      {lic.projectName}
                    </p>
                    {lic.packageName && (
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>{lic.packageName}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setLinkingLicenceId(linkingLicenceId === lic.id ? null : lic.id);
                      setNewProdName("");
                      setLinkError(null);
                    }}
                    className="shrink-0 rounded border px-3 py-1.5 text-xs font-medium transition hover:opacity-70"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
                  >
                    {linkingLicenceId === lic.id ? "Cancel" : "Create production"}
                  </button>
                </div>

                {linkingLicenceId === lic.id && (
                  <div
                    className="mt-3 rounded border p-3 flex flex-col gap-3"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                  >
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newProdName}
                        onChange={(e) => setNewProdName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void createAndLinkProduction(lic.id); }}
                        placeholder="Production name"
                        maxLength={120}
                        className="flex-1 rounded border px-3 py-2 text-sm outline-none"
                        style={{
                          borderColor: "var(--color-border)",
                          background: "var(--color-surface)",
                          color: "var(--color-ink)",
                        }}
                      />
                      {connectionIds.length > 1 && (
                        <select
                          value={selectedOrgId}
                          onChange={(e) => setSelectedOrgId(e.target.value)}
                          className="shrink-0 rounded border px-2 py-2 text-xs outline-none"
                          style={{
                            borderColor: "var(--color-border)",
                            background: "var(--color-surface)",
                            color: "var(--color-ink)",
                          }}
                        >
                          {connectionIds.map((org) => (
                            <option key={org.orgId} value={org.orgId}>{org.orgName}</option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => void createAndLinkProduction(lic.id)}
                        disabled={linkingBusy || !newProdName.trim()}
                        className="shrink-0 rounded border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition hover:opacity-80 disabled:opacity-40"
                        style={{ borderColor: "var(--color-ink)", color: "var(--color-ink)" }}
                      >
                        {linkingBusy ? (
                          <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                          </svg>
                        ) : "Create & link"}
                      </button>
                    </div>
                    {linkError && <p className="text-xs" style={{ color: "var(--color-danger)" }}>{linkError}</p>}
                  </div>
                )}
              </div>
            ))}
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
