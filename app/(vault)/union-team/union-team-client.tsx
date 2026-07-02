"use client";

import { useCallback, useEffect, useState } from "react";

interface Grant {
  id: string;
  complianceUserId: string;
  email: string | null;
  scope: string;
  scopeId: string | null;
  createdAt: number;
}

interface PendingInvite {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

interface UnionOption { id: string; shortName: string }

const SCOPE_LABELS: Record<string, string> = {
  platform: "Platform-wide",
  union: "Union scope",
  organisation: "Organisation",
  production: "Production",
  talent: "Performer",
};

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function UnionTeamClient() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [unions, setUnions] = useState<UnionOption[]>([]);
  const [unionId, setUnionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const load = useCallback(async (forUnion?: string | null) => {
    try {
      const qs = forUnion ? `?unionId=${encodeURIComponent(forUnion)}` : "";
      const res = await fetch(`/api/compliance/team${qs}`);
      const d = (await res.json()) as {
        grants?: Grant[];
        pendingInvites?: PendingInvite[];
        unions?: UnionOption[];
        unionId?: string;
        error?: string;
      };
      if (!res.ok || d.error) setError(d.error ?? `Failed (${res.status})`);
      else {
        setGrants(d.grants ?? []);
        setPendingInvites(d.pendingInvites ?? []);
        if (d.unions) setUnions(d.unions);
        if (d.unionId) setUnionId(d.unionId);
        setError(null);
      }
    } catch {
      setError("Failed to load team.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectUnion = useCallback((id: string) => {
    setUnionId(id);
    setLoading(true);
    void load(id);
  }, [load]);

  const sendInvite = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg(null);
    try {
      const res = await fetch("/api/compliance/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), unionId }),
      });
      const d = (await res.json()) as { error?: string; existing?: boolean };
      if (!res.ok || d.error) {
        setInviteMsg(d.error ?? "Failed to invite.");
      } else {
        setInviteMsg(d.existing ? `Access granted to ${inviteEmail.trim()}` : `Invite sent to ${inviteEmail.trim()}`);
        setInviteEmail("");
        await load(unionId);
      }
    } catch {
      setInviteMsg("Network error.");
    } finally {
      setInviting(false);
    }
  }, [inviteEmail, unionId, load]);

  const revoke = useCallback(async (id: string, label: string) => {
    if (!confirm(`Remove ${label} from the team?`)) return;
    try {
      await fetch(`/api/compliance/team/${id}`, { method: "DELETE" });
      await load(unionId);
    } catch {
      // ignore
    }
  }, [load, unionId]);

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Oversight</p>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-text)" }}>Union team</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Manage who has access to this union&apos;s compliance surfaces — watchlist, member roster, and evidence.
        </p>
      </div>

      {unions.length > 1 && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--color-muted)" }}>Union</span>
          {unions.map((u) => (
            <button key={u.id} onClick={() => selectUnion(u.id)}
              className="text-xs rounded px-3 py-1 font-medium"
              style={{
                background: unionId === u.id ? "var(--color-ink)" : "transparent",
                color: unionId === u.id ? "#fff" : "var(--color-muted)",
                border: "1px solid var(--color-border)",
              }}>
              {u.shortName}
            </button>
          ))}
        </div>
      )}

      {/* Invite form */}
      <div className="rounded-lg p-4 mb-5" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
        <p className="text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
          Invite a team member
        </p>
        <form onSubmit={(e) => void sendInvite(e)} className="flex items-center gap-2 flex-wrap">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="colleague@union.org"
            required
            className="text-sm rounded px-3 py-1.5 flex-1 min-w-[200px]"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
          />
          <button type="submit" disabled={inviting || !inviteEmail.trim()}
            className="text-sm rounded px-4 py-1.5 font-medium text-white whitespace-nowrap"
            style={{ background: "var(--color-accent)", opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }}>
            {inviting ? "Sending…" : "Send Invite"}
          </button>
        </form>
        {inviteMsg && (
          <p className="text-xs mt-2" style={{ color: inviteMsg.startsWith("Invite sent") || inviteMsg.startsWith("Access granted") ? "#166534" : "var(--color-accent)" }}>
            {inviteMsg}
          </p>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded animate-pulse" style={{ height: 52, background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg px-6 py-10 text-center" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-text)" }}>Access required</p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>{error}</p>
        </div>
      ) : (
        <>
          {/* Active members */}
          <div className="mb-5">
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
              Active members · {grants.length}
            </p>
            {grants.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>No team members yet — invite someone above.</p>
            ) : (
              <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
                {grants.map((g) => (
                  <div key={g.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                        {g.email ?? g.complianceUserId}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                        {SCOPE_LABELS[g.scope] ?? g.scope}
                        {" · joined "}
                        {fmtDate(g.createdAt)}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded shrink-0"
                      style={{ color: "#1a7f37", border: "1px solid #1a7f3744", background: "rgba(26,127,55,0.08)" }}>
                      Active
                    </span>
                    <button
                      onClick={() => void revoke(g.id, g.email ?? "this user")}
                      className="text-[11px] font-semibold uppercase tracking-widest shrink-0"
                      style={{ color: "var(--color-muted)" }}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending invites */}
          {pendingInvites.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
                Pending invites · {pendingInvites.length}
              </p>
              <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
                {pendingInvites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 px-4 py-2.5"
                    style={{ background: "rgba(180,83,9,0.04)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                        {inv.email}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                        Invited {fmtDate(inv.createdAt)} · expires {fmtDate(inv.expiresAt)}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded shrink-0"
                      style={{ color: "#b45309", border: "1px solid #b4530944", background: "rgba(180,83,9,0.08)" }}>
                      Pending
                    </span>
                    <button
                      onClick={() => void revoke(inv.id, inv.email)}
                      className="text-[11px] font-semibold uppercase tracking-widest shrink-0"
                      style={{ color: "var(--color-muted)" }}>
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
