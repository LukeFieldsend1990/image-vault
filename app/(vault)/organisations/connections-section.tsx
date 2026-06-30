"use client";

import { useCallback, useEffect, useState } from "react";
import OrgTypeBadge from "@/app/components/org-type-badge";
import CodeTag from "@/app/components/code-tag";

type Tier = "identity" | "contacts" | "shared_context";

interface Contact {
  email: string;
  memberRole: string;
}

interface ConnectionView {
  connectionId: string;
  productionId: string;
  productionName: string | null;
  status: "pending" | "active" | "declined" | "revoked";
  direction: "incoming" | "outgoing" | null;
  myTier: Tier;
  theirExposedTier: Tier | null;
  counterparty: {
    orgId: string;
    name: string;
    orgType: string | null;
    shortCode: string | null;
    country: string | null;
    vendorAuditPassed: boolean | null;
    contacts: Contact[] | null;
  };
}

const TIER_OPTIONS: { id: Tier; label: string; hint: string }[] = [
  { id: "identity", label: "Identity only", hint: "Name, type, code, jurisdiction and audit status" },
  { id: "contacts", label: "Identity + contacts", hint: "Also your owner/admin contacts" },
  { id: "shared_context", label: "Identity + contacts + production", hint: "Also the production you collaborate on" },
];

function tierLabel(t: Tier): string {
  return TIER_OPTIONS.find((o) => o.id === t)?.label ?? t;
}

/**
 * Organisation visibility connections — the consent surface for org-to-org
 * visibility. Lists incoming requests (accept/decline), outgoing requests
 * (cancel), and active connections (counterparty card at the tier they expose,
 * a control for what you share, and disconnect). Production-scoped and mutual:
 * nothing about the counterparty shows until both sides have accepted.
 */
export default function ConnectionsSection({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [connections, setConnections] = useState<ConnectionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [acceptTier, setAcceptTier] = useState<Record<string, Tier>>({});
  // Active connections render collapsed; click a row to reveal its details.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(connId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(connId)) next.delete(connId); else next.add(connId);
      return next;
    });
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/organisations/${orgId}/connections`);
      const d = (await r.json()) as { connections?: ConnectionView[] };
      setConnections(d.connections ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  async function respond(connId: string, action: "accept" | "decline", tier?: Tier) {
    setBusyId(connId);
    try {
      await fetch(`/api/connections/${connId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, tier }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(connId: string) {
    if (!confirm("Disconnect? Both organisations will immediately stop seeing each other.")) return;
    setBusyId(connId);
    try {
      await fetch(`/api/connections/${connId}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function changeTier(connId: string, tier: Tier) {
    setBusyId(connId);
    try {
      await fetch(`/api/connections/${connId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const incoming = connections.filter((c) => c.status === "pending" && c.direction === "incoming");
  const outgoing = connections.filter((c) => c.status === "pending" && c.direction === "outgoing");
  const active = connections.filter((c) => c.status === "active");

  const inputStyle = { border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" } as const;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--color-muted)" }}>
          Connections{connections.length > 0 ? ` · ${connections.length}` : ""}
        </p>
        <span
          title="To start one: open a production you share → Vendors → attach the organisation → Connect. Their request will appear here."
          aria-label="How connections work"
          className="flex items-center justify-center rounded-full"
          style={{ width: 14, height: 14, border: "1px solid var(--color-border)", color: "var(--color-muted)", fontSize: 9, fontWeight: 700 }}
        >
          i
        </span>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>
      ) : connections.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No connections yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Incoming requests */}
          {incoming.map((c) => {
            const tier = acceptTier[c.connectionId] ?? "identity";
            return (
              <div key={c.connectionId} className="rounded p-3" style={{ border: "1px solid var(--color-accent)", background: "rgba(192,57,43,0.04)" }}>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{c.counterparty.name}</span>
                  <OrgTypeBadge type={c.counterparty.orgType} />
                  <CodeTag code={c.counterparty.shortCode} />
                </div>
                <p className="text-xs mb-2" style={{ color: "var(--color-muted)" }}>
                  Wants to connect{c.productionName ? ` on ${c.productionName}` : ""}. Choose what you&apos;ll share back.
                </p>
                {canManage ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={tier}
                      onChange={(e) => setAcceptTier((m) => ({ ...m, [c.connectionId]: e.target.value as Tier }))}
                      className="rounded px-2 py-1.5 text-xs"
                      style={inputStyle}
                    >
                      {TIER_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                    <button
                      type="button"
                      disabled={busyId === c.connectionId}
                      onClick={() => void respond(c.connectionId, "accept", tier)}
                      className="rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                      style={{ background: "var(--color-accent)" }}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={busyId === c.connectionId}
                      onClick={() => void respond(c.connectionId, "decline")}
                      className="rounded px-3 py-1.5 text-xs disabled:opacity-60"
                      style={{ color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
                    >
                      Decline
                    </button>
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: "var(--color-muted)" }}>An owner or admin can respond.</p>
                )}
              </div>
            );
          })}

          {/* Outgoing requests */}
          {outgoing.map((c) => (
            <div key={c.connectionId} className="rounded p-3 flex items-center justify-between gap-3" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{c.counterparty.name}</span>
                  <OrgTypeBadge type={c.counterparty.orgType} />
                </div>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                  Request sent{c.productionName ? ` · ${c.productionName}` : ""} — awaiting their response.
                </p>
              </div>
              {canManage && (
                <button type="button" disabled={busyId === c.connectionId} onClick={() => void disconnect(c.connectionId)} className="text-xs shrink-0 disabled:opacity-60" style={{ color: "var(--color-accent)" }}>
                  Cancel
                </button>
              )}
            </div>
          ))}

          {/* Active connections — collapsed by default; click a row to expand */}
          {active.map((c) => {
            const isOpen = expanded.has(c.connectionId);
            return (
              <div key={c.connectionId} className="rounded" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                {/* Summary row — click to expand */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => toggleExpanded(c.connectionId)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpanded(c.connectionId); } }}
                  className="flex items-center justify-between gap-3 p-3 cursor-pointer"
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <svg
                      width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      className="shrink-0 transition-transform" style={{ color: "var(--color-muted)", transform: isOpen ? "rotate(90deg)" : undefined }}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{c.counterparty.name}</span>
                    <OrgTypeBadge type={c.counterparty.orgType} />
                    <CodeTag code={c.counterparty.shortCode} />
                  </div>
                  <span className="text-xs shrink-0" style={{ color: "var(--color-muted)" }}>Connected</span>
                </div>

                {/* Details — revealed on expand */}
                {isOpen && (
                  <div className="px-3 pb-3 pt-1 space-y-3" style={{ borderTop: "1px solid var(--color-border)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="mt-1 flex flex-col gap-0.5 text-xs min-w-0" style={{ color: "var(--color-muted)" }}>
                        {c.counterparty.country && <span>Jurisdiction: {c.counterparty.country}</span>}
                        {c.counterparty.vendorAuditPassed !== null && (
                          <span style={{ color: c.counterparty.vendorAuditPassed ? "#166534" : "#b45309" }}>
                            {c.counterparty.vendorAuditPassed ? "Environment audit passed" : "Environment audit pending"}
                          </span>
                        )}
                        {!c.counterparty.country && c.counterparty.vendorAuditPassed === null && !c.counterparty.contacts && (
                          <span>They share identity only.</span>
                        )}
                      </div>
                      {canManage && (
                        <button type="button" disabled={busyId === c.connectionId} onClick={() => void disconnect(c.connectionId)} className="text-xs shrink-0 disabled:opacity-60" style={{ color: "var(--color-accent)" }}>
                          Disconnect
                        </button>
                      )}
                    </div>

                    {/* Contacts (only when they've exposed them) */}
                    {c.counterparty.contacts && c.counterparty.contacts.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-muted)" }}>Contacts</p>
                        <div className="flex flex-col gap-0.5">
                          {c.counterparty.contacts.map((ct) => (
                            <span key={ct.email} className="text-xs" style={{ color: "var(--color-ink)" }}>
                              {ct.email} <span style={{ color: "var(--color-muted)" }}>· {ct.memberRole}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* What you share */}
                    {canManage && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs" style={{ color: "var(--color-muted)" }}>You share:</span>
                        <select
                          value={c.myTier}
                          disabled={busyId === c.connectionId}
                          onChange={(e) => void changeTier(c.connectionId, e.target.value as Tier)}
                          className="rounded px-2 py-1 text-xs"
                          style={inputStyle}
                        >
                          {TIER_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                        {c.theirExposedTier && (
                          <span className="text-xs" style={{ color: "var(--color-muted)" }}>They share: {tierLabel(c.theirExposedTier)}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
