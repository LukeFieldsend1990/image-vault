"use client";

import { useState } from "react";

export interface AgentMember {
  userId: string;
  email: string;
  shortCode: string | null;
  memberRole: "owner" | "admin" | "member";
  joinedAt: number;
}
export interface PendingInvite {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

function fmtDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function AgencyClient({
  organisationId,
  organisationName,
  shortCode,
  canManage,
  initialMembers,
  initialPending,
}: {
  organisationId: string;
  organisationName: string;
  shortCode: string | null;
  canManage: boolean;
  initialMembers: AgentMember[];
  initialPending: PendingInvite[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [pending, setPending] = useState(initialPending);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function inviteAgent(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/organisations/${organisationId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as {
        error?: string;
        inviteId?: string;
        attached?: boolean;
        userId?: string;
        shortCode?: string | null;
        memberRole?: "owner" | "admin" | "member";
        joinedAt?: number;
      };
      if (!res.ok) { setMsg({ kind: "err", text: data.error ?? "Could not send invite." }); return; }
      if (data.attached && data.userId) {
        setMsg({ kind: "ok", text: `${email} added to the agency.` });
        setMembers((m) => [...m, {
          userId: data.userId!,
          email,
          shortCode: data.shortCode ?? null,
          memberRole: data.memberRole ?? "member",
          joinedAt: data.joinedAt ?? Math.floor(Date.now() / 1000),
        }]);
      } else {
        setMsg({ kind: "ok", text: `Invite sent to ${email}.` });
        if (data.inviteId) {
          const now = Math.floor(Date.now() / 1000);
          setPending((p) => [...p, { id: data.inviteId!, email, createdAt: now, expiresAt: now + 7 * 24 * 60 * 60 }]);
        }
      }
      setEmail("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Agency</p>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
            {organisationName}
            {shortCode && (
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                {shortCode}
              </span>
            )}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
            {members.length} agent{members.length !== 1 ? "s" : ""} · {pending.length} pending invite{pending.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Invite */}
      {canManage && (
        <form
          onSubmit={inviteAgent}
          className="mb-6 rounded border p-5 space-y-3"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <label className="block text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Invite an agent
          </label>
          <div className="flex gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              type="email"
              placeholder="agent@agency.com"
              className="flex-1 border bg-white px-3 py-2 text-sm outline-none transition focus:border-[--color-accent]"
              style={{ borderColor: "var(--color-border)" }}
            />
            <button type="submit" disabled={busy} className="btn-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "Sending…" : "Send invite"}
            </button>
          </div>
          {msg && <p className="text-xs" style={{ color: msg.kind === "ok" ? "#166534" : "#991b1b" }}>{msg.text}</p>}
        </form>
      )}

      {/* Members */}
      <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>Agents</p>
      <div className="rounded border overflow-hidden mb-6" style={{ borderColor: "var(--color-border)" }}>
        {members.map((m) => (
          <div key={m.userId} className="flex items-center justify-between px-5 py-3 border-b last:border-0 text-sm" style={{ borderColor: "var(--color-border)" }}>
            <span className="flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
              {m.email}
              {m.shortCode && <span className="font-mono text-[10px]" style={{ color: "var(--color-muted)" }}>{m.shortCode}</span>}
            </span>
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
              {m.memberRole}
            </span>
          </div>
        ))}
      </div>

      {/* Pending */}
      {pending.length > 0 && (
        <>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>Pending invites</p>
          <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
            {pending.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3 border-b last:border-0 text-sm" style={{ borderColor: "var(--color-border)" }}>
                <span style={{ color: "var(--color-ink)" }}>{p.email}</span>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>expires {fmtDate(p.expiresAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
