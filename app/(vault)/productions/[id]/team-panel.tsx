"use client";

import { useCallback, useEffect, useState } from "react";

interface TeamMember {
  userId: string;
  email: string;
  role: "viewer" | "editor";
  addedAt: number;
}

interface OrgManager {
  userId: string;
  email: string;
  memberRole: string;
}

interface Candidate {
  userId: string;
  email: string;
}

interface TeamData {
  team: TeamMember[];
  orgManagers: OrgManager[];
  candidates: Candidate[];
  canManage: boolean;
}

const ROLE_LABEL: Record<string, string> = { viewer: "Read-only", editor: "Operational" };
const ROLE_BLURB: Record<string, string> = {
  viewer: "Can view the production — cast, vendors and details — but can't change anything.",
  editor: "Can add vendors and edit non-key details, cast, countries and insurers. Can't manage the team or delete.",
};

/**
 * Production team. The production owner (org owner/admin) explicitly associates
 * colleagues from their organisation with this production and chooses how much
 * each can do: read-only, or operational (add vendors / edit non-key details).
 */
export default function TeamPanel({ productionId }: { productionId: string }) {
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<"viewer" | "editor">("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/productions/${productionId}/team`);
      if (r.status === 403) { setForbidden(true); return; }
      if (!r.ok) return;
      const d = (await r.json()) as TeamData;
      setData(d);
    } finally {
      setLoading(false);
    }
  }, [productionId]);

  useEffect(() => { void load(); }, [load]);

  async function addMember() {
    if (!addUserId) { setError("Pick a colleague to add."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch(`/api/productions/${productionId}/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: addUserId, role: addRole }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) { setError(d.error ?? "Couldn't add member."); return; }
      setNotice("Added to the team.");
      setAddUserId(""); setAddRole("viewer");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, role: "viewer" | "editor") {
    setPendingId(userId); setError(""); setNotice("");
    try {
      const r = await fetch(`/api/productions/${productionId}/team/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (r.ok) await load();
    } finally {
      setPendingId(null);
    }
  }

  async function remove(userId: string, email: string) {
    if (!confirm(`Remove ${email} from this production's team?`)) return;
    setPendingId(userId); setError(""); setNotice("");
    try {
      const r = await fetch(`/api/productions/${productionId}/team/${userId}`, { method: "DELETE" });
      if (r.ok) await load();
    } finally {
      setPendingId(null);
    }
  }

  if (forbidden) return null;

  const inputStyle: React.CSSProperties = {
    border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)",
    borderRadius: 6, padding: "8px 12px", fontSize: 14, outline: "none",
  };

  const canManage = data?.canManage ?? false;

  return (
    <div>
      <p className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: "var(--color-muted)" }}>
        Team
      </p>
      <p className="text-xs mb-5" style={{ color: "var(--color-muted)" }}>
        {canManage
          ? "Add colleagues from your organisation to this production. Read-only members can view it; operational members can also add vendors and change non-key details."
          : "People from the production company who can access this production."}
      </p>

      {loading ? (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading…</p>
      ) : !data ? null : (
        <>
          {/* Add member — managers only */}
          {canManage && (
            <div className="rounded p-4 mb-6" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
              <p className="text-xs font-medium mb-3" style={{ color: "var(--color-text)" }}>Add a team member</p>
              {data.candidates.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  Everyone in your organisation is already an owner, admin, or on this team. Invite more colleagues to your organisation from Settings to add them here.
                </p>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                    <option value="">Select a colleague…</option>
                    {data.candidates.map((c) => (
                      <option key={c.userId} value={c.userId}>{c.email}</option>
                    ))}
                  </select>
                  <select value={addRole} onChange={(e) => setAddRole(e.target.value as "viewer" | "editor")} style={{ ...inputStyle, width: "auto" }}>
                    <option value="viewer">Read-only</option>
                    <option value="editor">Operational</option>
                  </select>
                  <button
                    onClick={addMember}
                    disabled={busy || !addUserId}
                    className="px-4 py-2 text-sm rounded font-medium text-white shrink-0"
                    style={{ background: "var(--color-accent)", opacity: busy || !addUserId ? 0.6 : 1 }}
                  >
                    {busy ? "Adding…" : "Add"}
                  </button>
                </div>
              )}
              <p className="text-[11px] mt-2" style={{ color: "var(--color-muted)" }}>{ROLE_BLURB[addRole]}</p>
            </div>
          )}

          {error && <p className="text-xs mb-2" style={{ color: "#991b1b" }}>{error}</p>}
          {notice && <p className="text-xs mb-2" style={{ color: "#166534" }}>{notice}</p>}

          {/* Owners & admins — implicit full access */}
          {data.orgManagers.length > 0 && (
            <div className="mb-6">
              <p className="text-[11px] font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>
                Owners &amp; admins
              </p>
              <div className="rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
                {data.orgManagers.map((m, i) => (
                  <div key={m.userId} className="flex items-center justify-between px-4 py-3"
                    style={{ borderBottom: i < data.orgManagers.length - 1 ? "1px solid var(--color-border)" : "none", background: "var(--color-bg)" }}>
                    <span className="text-sm" style={{ color: "var(--color-text)" }}>{m.email}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(124,58,237,0.1)", color: "#7c3aed" }}>
                      Full access · {m.memberRole === "owner" ? "Owner" : "Admin"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Explicitly added team members */}
          <div>
            <p className="text-[11px] font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>
              Added members{data.team.length > 0 ? ` · ${data.team.length}` : ""}
            </p>
            {data.team.length === 0 ? (
              <div className="rounded p-8 text-center" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                <p className="text-sm mb-1" style={{ color: "var(--color-text)" }}>No one added yet</p>
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {canManage ? "Add colleagues above to give them access to this production." : "No colleagues have been given explicit access to this production yet."}
                </p>
              </div>
            ) : (
              <div className="rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
                      {["Member", "Access", ""].map((h) => (
                        <th key={h} className="text-left px-4 py-2.5 text-xs font-medium tracking-wider uppercase" style={{ color: "var(--color-muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.team.map((m, i) => (
                      <tr key={m.userId} style={{ borderBottom: i < data.team.length - 1 ? "1px solid var(--color-border)" : "none", background: "var(--color-bg)" }}>
                        <td className="px-4 py-3" style={{ color: "var(--color-text)" }}>{m.email}</td>
                        <td className="px-4 py-3">
                          {canManage ? (
                            <select
                              value={m.role}
                              disabled={pendingId === m.userId}
                              onChange={(e) => changeRole(m.userId, e.target.value as "viewer" | "editor")}
                              style={{ ...inputStyle, padding: "4px 8px", fontSize: 13 }}
                            >
                              <option value="viewer">Read-only</option>
                              <option value="editor">Operational</option>
                            </select>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ background: m.role === "editor" ? "rgba(22,101,52,0.1)" : "rgba(107,114,128,0.12)", color: m.role === "editor" ? "#166534" : "#6b7280" }}>
                              {ROLE_LABEL[m.role]}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canManage && (
                            <button onClick={() => remove(m.userId, m.email)} disabled={pendingId === m.userId} className="text-xs" style={{ color: "var(--color-accent)" }}>
                              {pendingId === m.userId ? "…" : "Remove"}
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
        </>
      )}
    </div>
  );
}
