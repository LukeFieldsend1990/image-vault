"use client";

import { useState, useRef } from "react";
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

interface UserResult {
  id: string;
  email: string;
  role: string;
}

interface Props {
  orgId: string;
  members: Member[];
  invites: Invite[];
}

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

  // Add member state
  const [searchEmail, setSearchEmail] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<UserResult[] | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const [addRole, setAddRole] = useState<"owner" | "admin" | "member">("member");
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onSearchInput(val: string) {
    setSearchEmail(val);
    setSelectedUser(null);
    setAddErr(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.trim().length < 2) { setSearchResults(null); return; }
    searchTimeout.current = setTimeout(() => void doSearch(val.trim()), 300);
  }

  async function doSearch(q: string) {
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/users/search?email=${encodeURIComponent(q)}&role=licensee`);
      const d = await res.json() as { users?: UserResult[] };
      setSearchResults(d.users ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function addMember() {
    if (!selectedUser) return;
    setAdding(true);
    setAddErr(null);
    try {
      const res = await fetch(`/api/admin/organisations/${orgId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUser.id, memberRole: addRole }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setAddErr(d.error ?? "Failed to add member.");
      } else {
        setSearchEmail("");
        setSearchResults(null);
        setSelectedUser(null);
        setAddRole("member");
        router.refresh();
      }
    } catch {
      setAddErr("Failed to add member.");
    } finally {
      setAdding(false);
    }
  }

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

  const alreadyMemberIds = new Set(members.map((m) => m.userId));

  return (
    <div className="space-y-8">
      {/* Add Member */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
          Add Member
        </h2>
        <div className="rounded border p-4 space-y-3" style={{ borderColor: "var(--color-border)" }}>
          {/* Email search input */}
          <div className="relative">
            <input
              type="text"
              value={searchEmail}
              onChange={(e) => onSearchInput(e.target.value)}
              placeholder="Search by email (licensee users only)…"
              className="w-full text-sm px-3 py-2 rounded border outline-none"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-ink)",
              }}
            />
            {searching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: "var(--color-muted)" }}>
                Searching…
              </span>
            )}
          </div>

          {/* Search results dropdown */}
          {searchResults !== null && !selectedUser && (
            <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
              {searchResults.length === 0 ? (
                <p className="px-4 py-3 text-xs" style={{ color: "var(--color-muted)" }}>No licensee users found.</p>
              ) : (
                searchResults.map((u) => {
                  const alreadyIn = alreadyMemberIds.has(u.id);
                  return (
                    <button
                      key={u.id}
                      disabled={alreadyIn}
                      onClick={() => { setSelectedUser(u); setSearchResults(null); setSearchEmail(u.email); }}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-left border-b last:border-0 transition hover:bg-[var(--color-surface)] disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <span className="text-sm" style={{ color: "var(--color-ink)" }}>{u.email}</span>
                      {alreadyIn && (
                        <span className="text-[10px]" style={{ color: "var(--color-muted)" }}>Already a member</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Selected user + role + confirm */}
          {selectedUser && (
            <div className="flex items-center gap-3 flex-wrap">
              <div
                className="flex-1 flex items-center gap-2 px-3 py-2 rounded border text-sm min-w-0"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)", flexShrink: 0 }}>
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
                <span className="truncate" style={{ color: "var(--color-ink)" }}>{selectedUser.email}</span>
                <button
                  onClick={() => { setSelectedUser(null); setSearchEmail(""); setSearchResults(null); }}
                  className="ml-auto shrink-0 text-[10px] transition hover:opacity-70"
                  style={{ color: "var(--color-muted)" }}
                >
                  ✕
                </button>
              </div>

              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as "owner" | "admin" | "member")}
                className="text-xs px-2 py-2 rounded border appearance-none cursor-pointer shrink-0"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>

              <button
                onClick={() => void addMember()}
                disabled={adding}
                className="text-xs font-medium px-4 py-2 rounded transition hover:opacity-80 disabled:opacity-40 shrink-0"
                style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}
              >
                {adding ? "Adding…" : "Add to org"}
              </button>
            </div>
          )}

          {addErr && <p className="text-xs" style={{ color: "var(--color-accent)" }}>{addErr}</p>}
        </div>
      </section>

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
