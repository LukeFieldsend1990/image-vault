"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface AliasInfo {
  id: string;
  alias: string;
  aliasType: string;
  fullAddress: string;
  status: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function EmailIntakeClient() {
  const [aliases, setAliases] = useState<AliasInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);

  async function fetchAliases() {
    const res = await fetch("/api/inbound/aliases");
    if (res.ok) {
      const data = (await res.json()) as { enabled: boolean; aliases: AliasInfo[] };
      setEnabled(data.enabled);
      setAliases(data.aliases ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void fetchAliases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateAlias = async () => {
    setCreating(true);
    const res = await fetch("/api/inbound/aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: "user" }),
    });
    if (res.ok) {
      await fetchAliases();
    }
    setCreating(false);
  };

  const revokeAlias = async (id: string) => {
    await fetch(`/api/inbound/aliases/${id}/revoke`, { method: "POST" });
    await fetchAliases();
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopied(address);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return (
      <div className="p-8 max-w-2xl">
        <div className="h-6 w-48 rounded" style={{ background: "var(--color-surface)" }} />
      </div>
    );
  }

  const active = aliases.filter((a) => a.status === "active");
  const revoked = aliases.filter((a) => a.status === "revoked");

  if (!enabled) {
    return (
      <div className="p-8 max-w-2xl">
        <Link href="/settings" className="text-xs mb-4 inline-block transition" style={{ color: "var(--color-muted)" }}>
          &larr; Settings
        </Link>
        <h1 className="text-xl font-semibold mb-1">Email Intake</h1>
        <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
          Inbound email intake is not enabled for your account. Contact your administrator to enable it.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <Link href="/settings" className="text-xs mb-4 inline-block transition" style={{ color: "var(--color-muted)" }}>
        &larr; Settings
      </Link>

      <h1 className="text-xl font-semibold mb-1">Email Intake</h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
        Generate a private intake address you can CC into external conversations.
        Emails sent to this address are ingested, triaged by AI, and surfaced in your inbox for review.
      </p>

      {/* How it works */}
      <div
        className="rounded p-4 mb-6"
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
      >
        <h2 className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>
          HOW IT WORKS
        </h2>
        <ol className="text-xs space-y-1.5" style={{ color: "var(--color-text)" }}>
          <li>1. Generate your intake address below</li>
          <li>2. CC it into any relevant email conversation</li>
          <li>3. We ingest the thread, extract useful details, and prepare it for review</li>
          <li>4. Check your <Link href="/inbox" className="underline">Inbox</Link> to see AI summaries and take action</li>
        </ol>
      </div>

      {/* Active aliases */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
            ACTIVE ADDRESSES
          </h2>
          {active.length === 0 && (
            <button
              onClick={generateAlias}
              disabled={creating}
              className="px-3 py-1.5 text-xs rounded transition"
              style={{ background: "var(--color-ink)", color: "#fff" }}
            >
              {creating ? "Creating..." : "Generate Address"}
            </button>
          )}
        </div>

        {active.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            No active intake address. Click &quot;Generate Address&quot; to create one.
          </p>
        ) : (
          <div className="space-y-2">
            {active.map((alias) => (
              <div
                key={alias.id}
                className="rounded p-4"
                style={{ border: "1px solid var(--color-border)" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-mono truncate">{alias.fullAddress}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                      <span>Created {formatDate(alias.createdAt)}</span>
                      {alias.lastUsedAt && <span>Last used {formatDate(alias.lastUsedAt)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => copyAddress(alias.fullAddress)}
                      className="px-3 py-1 text-xs rounded transition"
                      style={{
                        background: copied === alias.fullAddress ? "#16a34a" : "var(--color-ink)",
                        color: "#fff",
                      }}
                    >
                      {copied === alias.fullAddress ? "Copied" : "Copy"}
                    </button>
                    <button
                      onClick={() => revokeAlias(alias.id)}
                      className="px-3 py-1 text-xs rounded transition"
                      style={{ border: "1px solid var(--color-border)", color: "#dc2626" }}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Revoked aliases */}
      {revoked.length > 0 && (
        <div>
          <h2 className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>
            REVOKED ADDRESSES
          </h2>
          <div className="space-y-2">
            {revoked.map((alias) => (
              <div
                key={alias.id}
                className="rounded p-3 flex items-center justify-between"
                style={{ border: "1px solid var(--color-border)", opacity: 0.5 }}
              >
                <span className="text-sm font-mono line-through">{alias.fullAddress}</span>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  Created {formatDate(alias.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Security note */}
      <div
        className="mt-8 rounded p-3 text-xs"
        style={{ background: "#d9770610", border: "1px solid #d9770630", color: "#d97706" }}
      >
        <strong>Security note:</strong> Your intake address is private. Anyone who knows it can send
        content to your account. If compromised, revoke it and generate a new one. Inbound emails
        create suggestions only — never irreversible actions.
      </div>
    </div>
  );
}
