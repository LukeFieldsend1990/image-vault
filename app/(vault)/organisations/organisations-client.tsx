"use client";

import { useState, useEffect, useCallback } from "react";
import { ORG_TYPES, ORG_TYPE_LABELS, type OrgType } from "@/lib/organisations/orgTypes";
import OrgTypeBadge from "@/app/components/org-type-badge";
import CodeTag from "@/app/components/code-tag";

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
  orgType?: string | null;
  shortCode?: string | null;
  ownerImplicitAccess?: boolean;
  memberRole: "owner" | "admin" | "member";
  joinedAt: number;
}

interface OrgDetail extends Organisation {
  members: OrgMember[];
}

const ROLE_COLOURS: Record<string, { bg: string; color: string }> = {
  owner: { bg: "rgba(192,57,43,0.10)", color: "#c0392b" },
  admin: { bg: "rgba(180,83,9,0.10)", color: "#b45309" },
  member: { bg: "var(--color-border)", color: "var(--color-muted)" },
};

function RoleBadge({ role }: { role: string }) {
  const c = ROLE_COLOURS[role] ?? ROLE_COLOURS.member;
  return (
    <span
      className="inline-block text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded align-middle"
      style={{ background: c.bg, color: c.color }}
    >
      {role}
    </span>
  );
}

export default function OrganisationsClient({ canCreate = true }: { canCreate?: boolean }) {
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

  const loadDetail = useCallback(async (orgId: string) => {
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/organisations/${orgId}`);
      const d = await r.json() as { organisation?: Organisation; members?: OrgMember[] };
      if (d.organisation && d.members) {
        setSelected((prev) => {
          const base = orgs.find(o => o.id === orgId);
          return {
            ...d.organisation!,
            memberRole: base?.memberRole ?? prev?.memberRole ?? "member",
            joinedAt: base?.joinedAt ?? prev?.joinedAt ?? 0,
            members: d.members!,
          };
        });
        setEditName(d.organisation.name);
        setEditWebsite(d.organisation.website ?? "");
        setEditBilling(d.organisation.billingEmail ?? "");
      }
    } catch {
      // ignore
    } finally {
      setDetailLoading(false);
    }
  }, [orgs]);

  function openOrg(orgId: string) {
    setShowEdit(false);
    setSaveMsg(null);
    setInviteMsg(null);
    void loadDetail(orgId);
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
      const d = await r.json() as { organisationId?: string };
      setShowCreate(false);
      setCreateName(""); setCreateWebsite(""); setCreateBilling("");
      await loadOrgs();
      if (d.organisationId) openOrg(d.organisationId);
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

  const [implicitSaving, setImplicitSaving] = useState(false);

  async function toggleImplicitAccess(next: boolean) {
    if (!selected) return;
    setImplicitSaving(true);
    // Optimistic — reflect the new state immediately, then reconcile from the server.
    setSelected((prev) => (prev ? { ...prev, ownerImplicitAccess: next } : prev));
    try {
      await fetch(`/api/organisations/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerImplicitAccess: next }),
      });
      await loadDetail(selected.id);
    } finally {
      setImplicitSaving(false);
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

  const inputCls = "rounded px-3 py-2 text-sm";
  const inputStyle = { border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" } as const;

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
            Your Network
          </p>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
            Organisations
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
            Manage your production companies, teams, members, and billing.
          </p>
        </div>
        {canCreate && !showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded px-4 py-2 text-sm font-medium text-white shrink-0"
            style={{ background: "var(--color-accent)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Organisation
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={createOrg}
          className="rounded-lg p-6 mb-8"
          style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
        >
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-4" style={{ color: "var(--color-muted)" }}>
            New Organisation
          </p>
          <div className="grid grid-cols-1 gap-3">
            <input
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              placeholder="Organisation name *"
              required
              className={inputCls}
              style={inputStyle}
            />
            <select
              value={createType}
              onChange={e => setCreateType(e.target.value as OrgType)}
              className={inputCls}
              style={inputStyle}
            >
              {ORG_TYPES.map(t => (
                <option key={t} value={t}>{ORG_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={createWebsite}
                onChange={e => setCreateWebsite(e.target.value)}
                placeholder="Website (optional)"
                type="url"
                className={inputCls}
                style={inputStyle}
              />
              <input
                value={createBilling}
                onChange={e => setCreateBilling(e.target.value)}
                placeholder="Billing email (optional)"
                type="email"
                className={inputCls}
                style={inputStyle}
              />
            </div>
          </div>
          {createError && <p className="text-xs mt-3" style={{ color: "var(--color-accent)" }}>{createError}</p>}
          <div className="flex gap-2 mt-5">
            <button
              type="submit"
              disabled={creating}
              className="rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: "var(--color-accent)" }}
            >
              {creating ? "Creating…" : "Create organisation"}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setCreateError(null); }}
              className="rounded px-4 py-2 text-sm"
              style={{ background: "transparent", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg animate-pulse" style={{ height: 88, background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && orgs.length === 0 && !showCreate && (
        <div
          className="rounded-lg px-8 py-14 text-center"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-4" style={{ color: "var(--color-muted)" }}>
            <path d="M3 21h18" />
            <path d="M5 21V7l8-4v18" />
            <path d="M19 21V11l-6-4" />
            <path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" />
          </svg>
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink)" }}>No organisations yet</p>
          <p className="text-xs mb-6 max-w-xs mx-auto" style={{ color: "var(--color-muted)" }}>
            {canCreate
              ? "Create a production company to invite your team, manage members, and centralise billing."
              : "You're not a member of any organisation yet. Ask an organisation owner to send you an invite."}
          </p>
          {canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded px-5 py-2 text-sm font-medium text-white"
              style={{ background: "var(--color-accent)" }}
            >
              Create your first organisation
            </button>
          )}
        </div>
      )}

      {/* Org list */}
      {!loading && orgs.length > 0 && (
        <div className="space-y-3">
          {orgs.map(org => {
            const active = selected?.id === org.id;
            return (
              <div
                key={org.id}
                className="group rounded-lg overflow-hidden transition"
                style={{
                  border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
                  background: "var(--color-surface)",
                }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openOrg(org.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openOrg(org.id); } }}
                  className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
                        {org.name}
                      </h2>
                      <OrgTypeBadge type={org.orgType} />
                      <CodeTag code={org.shortCode} />
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: "var(--color-muted)" }}>
                      <RoleBadge role={org.memberRole} />
                      <span>·</span>
                      <span>Joined {new Date(org.joinedAt * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    className="shrink-0 transition-transform group-hover:translate-x-0.5"
                    style={{ color: "var(--color-muted)", transform: active ? "rotate(90deg)" : undefined }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>

                {/* Inline detail */}
                {active && (
                  <div className="px-5 pb-5 pt-1 space-y-4" style={{ borderTop: "1px solid var(--color-border)" }}>
                    {detailLoading && (
                      <p className="text-sm pt-3" style={{ color: "var(--color-muted)" }}>Loading…</p>
                    )}

                    {selected && !detailLoading && (
                      <>
                        {/* Details */}
                        <div className="pt-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--color-muted)" }}>Details</p>
                            {canManage && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={() => { setShowEdit(!showEdit); setSaveMsg(null); }}
                                onKeyDown={(e) => { if (e.key === "Enter") { setShowEdit(!showEdit); setSaveMsg(null); } }}
                                className="text-xs cursor-pointer"
                                style={{ color: "var(--color-accent)" }}
                              >
                                {showEdit ? "Cancel" : "Edit"}
                              </span>
                            )}
                          </div>
                          {showEdit && canManage ? (
                            <form onSubmit={saveEdit} className="flex flex-col gap-3">
                              <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name *" required className={inputCls} style={inputStyle} />
                              <input value={editWebsite} onChange={e => setEditWebsite(e.target.value)} placeholder="Website" type="url" className={inputCls} style={inputStyle} />
                              <input value={editBilling} onChange={e => setEditBilling(e.target.value)} placeholder="Billing email" type="email" className={inputCls} style={inputStyle} />
                              {saveMsg && <p className="text-xs" style={{ color: saveMsg === "Saved" ? "#166534" : "var(--color-accent)" }}>{saveMsg}</p>}
                              <button type="submit" disabled={saving} className="self-start rounded px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60" style={{ background: "var(--color-accent)" }}>
                                {saving ? "Saving…" : "Save"}
                              </button>
                            </form>
                          ) : (
                            <div className="text-sm flex flex-col gap-1" style={{ color: "var(--color-ink)" }}>
                              {selected.website ? (
                                <a href={selected.website} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--color-muted)" }} onClick={(e) => e.stopPropagation()}>
                                  {selected.website}
                                </a>
                              ) : (
                                <span style={{ color: "var(--color-muted)" }}>No website set</span>
                              )}
                              <span style={{ color: "var(--color-muted)" }}>
                                {selected.billingEmail ? `Billing: ${selected.billingEmail}` : "No billing email set"}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Production access — owner-only governance toggle */}
                        {isOwner && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
                              Production access
                            </p>
                            <label className="flex items-start gap-3 cursor-pointer rounded p-3" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
                              <input
                                type="checkbox"
                                checked={Boolean(selected.ownerImplicitAccess)}
                                disabled={implicitSaving}
                                onChange={(e) => void toggleImplicitAccess(e.target.checked)}
                                className="mt-0.5"
                              />
                              <span className="text-sm" style={{ color: "var(--color-ink)" }}>
                                Give organisation owners access to every production
                                <span className="block text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                                  When on, all owners can see and manage every production this organisation owns. When off, each production is private to its owner unless colleagues are explicitly added to its team.
                                </span>
                              </span>
                            </label>
                          </div>
                        )}

                        {/* Members */}
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
                            Members · {selected.members.length}
                          </p>
                          <div className="flex flex-col divide-y" style={{ borderColor: "var(--color-border)" }}>
                            {selected.members.map(m => (
                              <div key={m.userId} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="truncate" style={{ color: "var(--color-ink)" }}>{m.email}</span>
                                  <RoleBadge role={m.memberRole} />
                                </div>
                                {canManage && (
                                  <div className="flex items-center gap-2 shrink-0">
                                    {isOwner && (
                                      <select
                                        value={m.memberRole}
                                        onChange={e => void changeRole(m.userId, e.target.value)}
                                        className="text-xs rounded px-1.5 py-1 cursor-pointer"
                                        style={inputStyle}
                                      >
                                        <option value="owner">Owner</option>
                                        <option value="admin">Admin</option>
                                        <option value="member">Member</option>
                                      </select>
                                    )}
                                    <button
                                      onClick={() => void removeMember(m.userId)}
                                      className="text-xs cursor-pointer"
                                      style={{ color: "var(--color-accent)" }}
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
                          <div>
                            <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>Invite Member</p>
                            <form onSubmit={sendInvite} className="flex gap-2">
                              <input
                                type="email"
                                value={inviteEmail}
                                onChange={e => setInviteEmail(e.target.value)}
                                placeholder="colleague@studio.com"
                                required
                                className={`flex-1 ${inputCls}`}
                                style={inputStyle}
                              />
                              <button type="submit" disabled={inviting} className="rounded px-4 py-2 text-sm font-medium text-white whitespace-nowrap disabled:opacity-60" style={{ background: "var(--color-accent)" }}>
                                {inviting ? "Sending…" : "Send Invite"}
                              </button>
                            </form>
                            {inviteMsg && <p className="text-xs mt-2" style={{ color: inviteMsg.startsWith("Invite sent") ? "#166534" : "var(--color-accent)" }}>{inviteMsg}</p>}
                          </div>
                        )}
                      </>
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
