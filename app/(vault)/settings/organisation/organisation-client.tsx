"use client";

import { useState, useEffect, useCallback } from "react";
import { ORG_TYPES, ORG_TYPE_LABELS, type OrgType } from "@/lib/organisations/orgTypes";

interface OrgMember {
  userId: string;
  email: string;
  memberRole: "owner" | "admin" | "member";
  joinedAt: number;
}

interface Organisation {
  id: string;
  name: string;
  website: string | null;
  billingEmail: string | null;
  memberRole: "owner" | "admin" | "member";
  joinedAt: number;
}

interface OrgDetail extends Organisation {
  members: OrgMember[];
}

export default function OrganisationClient() {
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OrgDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create org state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<OrgType>("production_company");
  const [createWebsite, setCreateWebsite] = useState("");
  const [createBilling, setCreateBilling] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  // Edit state
  const [editName, setEditName] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editBilling, setEditBilling] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);

  const loadOrgs = useCallback(async () => {
    try {
      const r = await fetch("/api/organisations");
      const d = await r.json() as { organisations?: Organisation[] };
      setOrgs(d.organisations ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOrgs(); }, [loadOrgs]);

  async function loadDetail(orgId: string) {
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/organisations/${orgId}`);
      const d = await r.json() as { organisation?: Organisation; members?: OrgMember[] };
      if (d.organisation && d.members) {
        const base = orgs.find(o => o.id === orgId);
        setSelected({ ...d.organisation, memberRole: base?.memberRole ?? "member", joinedAt: base?.joinedAt ?? 0, members: d.members });
        setEditName(d.organisation.name);
        setEditWebsite(d.organisation.website ?? "");
        setEditBilling(d.organisation.billingEmail ?? "");
      }
    } catch {
      // ignore
    } finally {
      setDetailLoading(false);
    }
  }

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetch("/api/organisations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName, orgType: createType, website: createWebsite || undefined, billingEmail: createBilling || undefined }),
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        setCreateError(d.error ?? "Failed to create organisation");
        return;
      }
      setShowCreate(false);
      setCreateName(""); setCreateWebsite(""); setCreateBilling("");
      await loadOrgs();
    } catch {
      setCreateError("Network error");
    } finally {
      setCreating(false);
    }
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setInviting(true);
    setInviteMsg(null);
    try {
      const r = await fetch(`/api/organisations/${selected.id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const d = await r.json() as { error?: string };
      if (!r.ok) {
        setInviteMsg(d.error ?? "Failed to send invite");
      } else {
        setInviteMsg(`Invite sent to ${inviteEmail}`);
        setInviteEmail("");
      }
    } catch {
      setInviteMsg("Network error");
    } finally {
      setInviting(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await fetch(`/api/organisations/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, website: editWebsite || null, billingEmail: editBilling || null }),
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        setSaveMsg(d.error ?? "Save failed");
      } else {
        setSaveMsg("Saved");
        setShowEdit(false);
        await loadOrgs();
        await loadDetail(selected.id);
      }
    } catch {
      setSaveMsg("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(userId: string) {
    if (!selected) return;
    if (!confirm("Remove this member?")) return;
    await fetch(`/api/organisations/${selected.id}/members/${userId}`, { method: "DELETE" });
    await loadDetail(selected.id);
  }

  async function changeRole(userId: string, memberRole: string) {
    if (!selected) return;
    await fetch(`/api/organisations/${selected.id}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberRole }),
    });
    await loadDetail(selected.id);
  }

  const canManage = selected?.memberRole === "owner" || selected?.memberRole === "admin";
  const isOwner = selected?.memberRole === "owner";

  if (loading) {
    return (
      <div style={{ padding: "2rem", color: "var(--color-muted)", fontSize: "0.875rem" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, padding: "2rem 1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <p style={{ fontSize: "0.65rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", marginBottom: "0.25rem" }}>
            Settings
          </p>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text)" }}>Organisation</h1>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            style={{ fontSize: "0.75rem", padding: "0.4rem 0.9rem", background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            New Organisation
          </button>
        )}
      </div>

      {showCreate && (
        <form onSubmit={createOrg} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "1.25rem", marginBottom: "1.5rem" }}>
          <p style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "1rem", color: "var(--color-text)" }}>Create Organisation</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <input
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              placeholder="Organisation name *"
              required
              style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-bg)", color: "var(--color-text)" }}
            />
            <select
              value={createType}
              onChange={e => setCreateType(e.target.value as OrgType)}
              style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-bg)", color: "var(--color-text)" }}
            >
              {ORG_TYPES.map(t => (
                <option key={t} value={t}>{ORG_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <input
              value={createWebsite}
              onChange={e => setCreateWebsite(e.target.value)}
              placeholder="Website (optional)"
              type="url"
              style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-bg)", color: "var(--color-text)" }}
            />
            <input
              value={createBilling}
              onChange={e => setCreateBilling(e.target.value)}
              placeholder="Billing email (optional)"
              type="email"
              style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-bg)", color: "var(--color-text)" }}
            />
          </div>
          {createError && <p style={{ fontSize: "0.75rem", color: "var(--color-accent)", marginTop: "0.5rem" }}>{createError}</p>}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="submit" disabled={creating} style={{ fontSize: "0.75rem", padding: "0.4rem 0.9rem", background: "var(--color-text)", color: "var(--color-bg)", border: "none", borderRadius: 4, cursor: "pointer" }}>
              {creating ? "Creating…" : "Create"}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} style={{ fontSize: "0.75rem", padding: "0.4rem 0.9rem", background: "transparent", color: "var(--color-muted)", border: "1px solid var(--color-border)", borderRadius: 4, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {orgs.length === 0 && !showCreate && (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: "2rem", textAlign: "center", color: "var(--color-muted)", fontSize: "0.875rem" }}>
          You are not a member of any organisation.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {orgs.map(org => (
          <button
            key={org.id}
            onClick={() => { void loadDetail(org.id); setShowEdit(false); setSaveMsg(null); setInviteMsg(null); }}
            style={{
              textAlign: "left", background: selected?.id === org.id ? "var(--color-surface)" : "transparent",
              border: `1px solid ${selected?.id === org.id ? "var(--color-accent)" : "var(--color-border)"}`,
              borderRadius: 6, padding: "1rem", cursor: "pointer", width: "100%",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--color-text)" }}>{org.name}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginTop: 2 }}>
              {org.memberRole} · joined {new Date(org.joinedAt * 1000).toLocaleDateString()}
            </div>
          </button>
        ))}
      </div>

      {detailLoading && (
        <div style={{ marginTop: "1.5rem", color: "var(--color-muted)", fontSize: "0.875rem" }}>Loading…</div>
      )}

      {selected && !detailLoading && (
        <div style={{ marginTop: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>

          {/* Edit details */}
          {canManage && (
            <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <p style={{ fontSize: "0.65rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)" }}>Details</p>
                <button onClick={() => setShowEdit(!showEdit)} style={{ fontSize: "0.7rem", color: "var(--color-muted)", background: "none", border: "none", cursor: "pointer" }}>
                  {showEdit ? "Cancel" : "Edit"}
                </button>
              </div>
              {showEdit ? (
                <form onSubmit={saveEdit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name *" required style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-bg)", color: "var(--color-text)" }} />
                  <input value={editWebsite} onChange={e => setEditWebsite(e.target.value)} placeholder="Website" type="url" style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-bg)", color: "var(--color-text)" }} />
                  <input value={editBilling} onChange={e => setEditBilling(e.target.value)} placeholder="Billing email" type="email" style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-bg)", color: "var(--color-text)" }} />
                  {saveMsg && <p style={{ fontSize: "0.75rem", color: saveMsg === "Saved" ? "var(--color-text)" : "var(--color-accent)" }}>{saveMsg}</p>}
                  <button type="submit" disabled={saving} style={{ alignSelf: "flex-start", fontSize: "0.75rem", padding: "0.4rem 0.9rem", background: "var(--color-text)", color: "var(--color-bg)", border: "none", borderRadius: 4, cursor: "pointer" }}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                </form>
              ) : (
                <div style={{ fontSize: "0.875rem", display: "flex", flexDirection: "column", gap: "0.25rem", color: "var(--color-text)" }}>
                  <div>{selected.name}</div>
                  {selected.website && <div style={{ color: "var(--color-muted)" }}>{selected.website}</div>}
                  {selected.billingEmail && <div style={{ color: "var(--color-muted)" }}>Billing: {selected.billingEmail}</div>}
                </div>
              )}
            </div>
          )}

          {/* Members */}
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "1.25rem" }}>
            <p style={{ fontSize: "0.65rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", marginBottom: "0.75rem" }}>Members</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {selected.members.map(m => (
                <div key={m.userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.875rem" }}>
                  <div>
                    <span style={{ color: "var(--color-text)" }}>{m.email}</span>
                    <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", color: "var(--color-muted)" }}>{m.memberRole}</span>
                  </div>
                  {canManage && (
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {isOwner && (
                        <select
                          value={m.memberRole}
                          onChange={e => void changeRole(m.userId, e.target.value)}
                          style={{ fontSize: "0.7rem", padding: "0.2rem 0.4rem", border: "1px solid var(--color-border)", borderRadius: 3, background: "var(--color-bg)", color: "var(--color-text)", cursor: "pointer" }}
                        >
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      )}
                      <button
                        onClick={() => void removeMember(m.userId)}
                        style={{ fontSize: "0.7rem", color: "var(--color-accent)", background: "none", border: "none", cursor: "pointer" }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Invite */}
          {canManage && (
            <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "1.25rem" }}>
              <p style={{ fontSize: "0.65rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", marginBottom: "0.75rem" }}>Invite Member</p>
              <form onSubmit={sendInvite} style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@studio.com"
                  required
                  style={{ flex: 1, padding: "0.5rem 0.75rem", fontSize: "0.875rem", border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-bg)", color: "var(--color-text)" }}
                />
                <button type="submit" disabled={inviting} style={{ fontSize: "0.75rem", padding: "0.4rem 0.9rem", background: "var(--color-text)", color: "var(--color-bg)", border: "none", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {inviting ? "Sending…" : "Send Invite"}
                </button>
              </form>
              {inviteMsg && <p style={{ fontSize: "0.75rem", marginTop: "0.5rem", color: inviteMsg.startsWith("Invite sent") ? "var(--color-text)" : "var(--color-accent)" }}>{inviteMsg}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
