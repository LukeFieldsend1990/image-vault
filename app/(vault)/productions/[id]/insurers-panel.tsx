"use client";

import { useCallback, useEffect, useState } from "react";

interface InsurerGrant {
  id: string;
  complianceUserId: string;
  email: string | null;
  subtype: string;
  createdAt: number;
}

interface PendingInvite {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Insurers attached to this production. Insurance is bound per production, so an
 * insurer added here gets read-only, production-scoped oversight only.
 */
export default function InsurersPanel({ productionId, canWrite = true }: { productionId: string; canWrite?: boolean }) {
  const [insurers, setInsurers] = useState<InsurerGrant[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [email, setEmail] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchInsurers = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/productions/${productionId}/insurers`);
      if (r.status === 403) {
        setForbidden(true);
        return;
      }
      if (!r.ok) return;
      const data = (await r.json()) as { insurers: InsurerGrant[]; pendingInvites: PendingInvite[] };
      setInsurers(data.insurers ?? []);
      setPending(data.pendingInvites ?? []);
    } finally {
      setLoading(false);
    }
  }, [productionId]);

  useEffect(() => {
    void fetchInsurers();
  }, [fetchInsurers]);

  async function handleAdd() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setAdding(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(`/api/productions/${productionId}/insurers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await r.json()) as { status?: string; error?: string };
      if (!r.ok) {
        setError(data.error ?? "Could not add insurer.");
        return;
      }
      setNotice(
        data.status === "invited"
          ? `Invite sent to ${trimmed}.`
          : `${trimmed} granted access to this production.`,
      );
      setEmail("");
      await fetchInsurers();
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(rowId: string, label: string) {
    if (!confirm(`Remove ${label}'s access to this production?`)) return;
    setRemovingId(rowId);
    try {
      const r = await fetch(`/api/productions/${productionId}/insurers/${rowId}`, { method: "DELETE" });
      if (r.ok) await fetchInsurers();
    } finally {
      setRemovingId(null);
    }
  }

  // Producers/admins manage insurers; for anyone else the endpoint 403s and we hide the panel.
  if (forbidden) return null;

  const total = insurers.length + pending.length;

  return (
    <div className="mt-8">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Insurers{total > 0 ? ` · ${total}` : ""}
        </p>
        {canWrite && (
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-white"
            style={{ background: "var(--color-accent)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Insurer
          </button>
        )}
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
        Read-only oversight of this production&apos;s consent &amp; custody evidence. Scoped to this production only.
      </p>

      {/* Add insurer */}
      {showAdd && canWrite && (
        <div className="rounded p-4 mb-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAdd();
              }}
              placeholder="insurer@example.com"
              className="flex-1 px-3 py-2 text-sm rounded"
              style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
            />
            <button
              onClick={() => void handleAdd()}
              disabled={adding}
              className="px-4 py-2 text-sm rounded font-medium"
              style={{ background: "var(--color-accent)", color: "#fff", opacity: adding ? 0.6 : 1 }}
            >
              {adding ? "Adding…" : "Add insurer"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs mb-3" style={{ color: "#991b1b" }}>{error}</p>}
      {notice && <p className="text-xs mb-3" style={{ color: "#166534" }}>{notice}</p>}

      {loading ? (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading…</p>
      ) : total === 0 ? (
        <div className="rounded p-8 text-center" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm mb-1" style={{ color: "var(--color-text)" }}>No insurers yet</p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>Use the Add Insurer button to grant read-only oversight.</p>
        </div>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
                {["Insurer", "Status", "Added", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-medium tracking-wider uppercase" style={{ color: "var(--color-muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {insurers.map((g, i) => (
                <tr
                  key={g.id}
                  style={{
                    borderBottom:
                      i < insurers.length - 1 || pending.length > 0 ? "1px solid var(--color-border)" : "none",
                    background: "var(--color-bg)",
                  }}
                >
                  <td className="px-4 py-3" style={{ color: "var(--color-text)" }}>{g.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(22,101,52,0.12)", color: "#166534" }}>
                      Active
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--color-muted)" }}>{fmtDate(g.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {canWrite && (
                      <button
                        onClick={() => void handleRemove(g.id, g.email ?? "this insurer")}
                        disabled={removingId === g.id}
                        className="text-xs"
                        style={{ color: "var(--color-accent)" }}
                      >
                        {removingId === g.id ? "Removing…" : "Revoke"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {pending.map((inv, i) => (
                <tr
                  key={inv.id}
                  style={{
                    borderBottom: i < pending.length - 1 ? "1px solid var(--color-border)" : "none",
                    background: "var(--color-bg)",
                  }}
                >
                  <td className="px-4 py-3" style={{ color: "var(--color-text)" }}>{inv.email}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(180,83,9,0.12)", color: "#b45309" }}>
                      Invited
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--color-muted)" }}>{fmtDate(inv.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {canWrite && (
                      <button
                        onClick={() => void handleRemove(inv.id, inv.email)}
                        disabled={removingId === inv.id}
                        className="text-xs"
                        style={{ color: "var(--color-accent)" }}
                      >
                        {removingId === inv.id ? "Removing…" : "Cancel"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
