"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Member {
  userId: string;
  email: string;
  memberRole: "owner" | "admin" | "member";
  joinedAt: number;
}

interface Invite {
  id: string;
  invitedEmail: string;
  expiresAt: number;
  acceptedAt: number | null;
  createdAt: number;
}

interface Props {
  orgId: string;
  members: Member[];
  invites: Invite[];
}

const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  owner: { bg: "rgba(192,57,43,0.10)", color: "var(--color-accent)" },
  admin: { bg: "rgba(234,179,8,0.12)", color: "#92400e" },
  member: { bg: "var(--color-border)", color: "var(--color-muted)" },
};

function fmtDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function isExpired(epoch: number) {
  return epoch < Math.floor(Date.now() / 1000);
}

export default function OrgAdminClient({ orgId, members, invites }: Props) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function removeMember(userId: string) {
    setRemoving(userId);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/organisations/${orgId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setErr(d.error ?? "Remove failed.");
      } else {
        router.refresh();
      }
    } catch {
      setErr("Remove failed.");
    } finally {
      setRemoving(null);
    }
  }

  async function changeRole(userId: string, memberRole: string) {
    setChangingRole(userId);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/organisations/${orgId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, memberRole }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setErr(d.error ?? "Role change failed.");
      } else {
        router.refresh();
      }
    } catch {
      setErr("Role change failed.");
    } finally {
      setChangingRole(null);
    }
  }

  const pendingInvites = invites.filter((i) => !i.acceptedAt && !isExpired(i.expiresAt));
  const pastInvites = invites.filter((i) => i.acceptedAt || isExpired(i.expiresAt));

  return (
    <div className="space-y-8">
      {/* Members */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
          Members ({members.length})
        </h2>

        {members.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>No members yet.</p>
        ) : (
          <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
            {members.map((m) => {
              const roleStyle = ROLE_COLORS[m.memberRole] ?? ROLE_COLORS.member;
              return (
                <div
                  key={m.userId}
                  className="flex items-center justify-between px-5 py-3.5 border-b last:border-0 gap-4"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>{m.email}</p>
                    <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>Joined {fmtDate(m.joinedAt)}</p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {/* Role selector */}
                    <select
                      value={m.memberRole}
                      disabled={changingRole === m.userId}
                      onChange={(e) => void changeRole(m.userId, e.target.value)}
                      className="text-[11px] px-2 py-1 rounded border appearance-none cursor-pointer"
                      style={{
                        borderColor: "var(--color-border)",
                        background: roleStyle.bg,
                        color: roleStyle.color,
                        fontWeight: 600,
                      }}
                    >
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>

                    {/* Remove button */}
                    <button
                      onClick={() => void removeMember(m.userId)}
                      disabled={removing === m.userId}
                      className="text-xs px-3 py-1 rounded border transition hover:opacity-70 disabled:opacity-40"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
                    >
                      {removing === m.userId ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
            Pending Invites
          </h2>
          <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
            {pendingInvites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between px-5 py-3.5 border-b last:border-0 gap-4"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div>
                  <p className="text-sm" style={{ color: "var(--color-ink)" }}>{inv.invitedEmail}</p>
                  <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                    Sent {fmtDate(inv.createdAt)} · Expires {fmtDate(inv.expiresAt)}
                  </p>
                </div>
                <span
                  className="text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
                  style={{ background: "rgba(234,179,8,0.12)", color: "#92400e" }}
                >
                  Pending
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Past invites */}
      {pastInvites.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
            Past Invites
          </h2>
          <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
            {pastInvites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between px-5 py-3.5 border-b last:border-0 gap-4"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div>
                  <p className="text-sm" style={{ color: "var(--color-muted)" }}>{inv.invitedEmail}</p>
                  <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                    Sent {fmtDate(inv.createdAt)}
                  </p>
                </div>
                <span
                  className="text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
                  style={
                    inv.acceptedAt
                      ? { background: "#16653418", color: "#166534" }
                      : { background: "var(--color-border)", color: "var(--color-muted)" }
                  }
                >
                  {inv.acceptedAt ? "Accepted" : "Expired"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {err && (
        <p className="text-xs" style={{ color: "var(--color-accent)" }}>{err}</p>
      )}
    </div>
  );
}
