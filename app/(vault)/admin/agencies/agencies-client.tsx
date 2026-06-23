"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export interface AgencyRow {
  id: string;
  name: string;
  shortCode: string | null;
  website: string | null;
  createdAt: number;
  memberCount: number;
}

interface AgentMember {
  userId: string;
  email: string;
  shortCode: string | null;
  memberRole: "owner" | "admin" | "member";
  joinedAt: number;
}
interface PendingInvite {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

function fmtDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const inputClass =
  "block w-full border bg-white px-3 py-2 text-sm outline-none transition focus:border-[--color-accent]";

export default function AgenciesClient({ agencies }: { agencies: AgencyRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [ownerMode, setOwnerMode] = useState<"invite" | "existing">("invite");
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [existingRepEmail, setExistingRepEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [createError, setCreateError] = useState("");
  const [createOk, setCreateOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  function resetForm() {
    setName("");
    setAdminEmail("");
    setExistingRepEmail("");
    setWebsite("");
    setCreateError("");
    setCreateOk("");
    setOwnerMode("invite");
  }

  async function createAgency(e: React.FormEvent) {
    e.preventDefault();
    setCreateError("");
    setCreateOk("");
    setBusy(true);
    try {
      const payload =
        ownerMode === "existing"
          ? { name, existingRepEmail, website: website || undefined }
          : { name, adminEmail, website: website || undefined };

      const res = await fetch("/api/admin/agencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string; shortCode?: string; ownerLinked?: boolean };
      if (!res.ok) {
        setCreateError(data.error ?? "Could not create agency.");
        return;
      }
      const codeStr = data.shortCode ? ` (${data.shortCode})` : "";
      if (ownerMode === "existing") {
        setCreateOk(`Agency created${codeStr}. ${existingRepEmail} is now the owner.`);
      } else {
        setCreateOk(`Agency created${codeStr}. Invite sent to ${adminEmail}.`);
      }
      resetForm();
      setCreating(false);
      router.refresh();
    } catch {
      setCreateError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Create */}
      <div className="mb-6">
        {!creating ? (
          <button
            onClick={() => { setCreating(true); setCreateOk(""); }}
            className="btn-accent px-4 py-2.5 text-sm font-medium text-white"
          >
            Provision agency
          </button>
        ) : (
          <form
            onSubmit={createAgency}
            className="rounded border p-5 space-y-4"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              New agency
            </h2>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--color-muted)" }}>Agency name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Curtis Brown" className={inputClass} style={{ borderColor: "var(--color-border)" }} />
            </div>

            {/* Owner mode toggle */}
            <div>
              <p className="text-xs mb-2" style={{ color: "var(--color-muted)" }}>Owner</p>
              <div className="flex gap-0 rounded overflow-hidden border text-xs" style={{ borderColor: "var(--color-border)" }}>
                <button
                  type="button"
                  onClick={() => setOwnerMode("invite")}
                  className="flex-1 px-3 py-2 text-center transition"
                  style={{
                    background: ownerMode === "invite" ? "var(--color-accent)" : "var(--color-surface)",
                    color: ownerMode === "invite" ? "#fff" : "var(--color-muted)",
                  }}
                >
                  Invite new agent
                </button>
                <button
                  type="button"
                  onClick={() => setOwnerMode("existing")}
                  className="flex-1 px-3 py-2 text-center transition"
                  style={{
                    background: ownerMode === "existing" ? "var(--color-accent)" : "var(--color-surface)",
                    color: ownerMode === "existing" ? "#fff" : "var(--color-muted)",
                    borderLeft: "1px solid var(--color-border)",
                  }}
                >
                  Assign existing agent
                </button>
              </div>
            </div>

            {ownerMode === "invite" ? (
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "var(--color-muted)" }}>First administrator&apos;s email</label>
                <input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required type="email" placeholder="admin@curtisbrown.com" className={inputClass} style={{ borderColor: "var(--color-border)" }} />
                <p className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
                  They receive the agent onboarding link and become the agency owner on signup.
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "var(--color-muted)" }}>Existing agent&apos;s email</label>
                <input value={existingRepEmail} onChange={(e) => setExistingRepEmail(e.target.value)} required type="email" placeholder="agent@curtisbrown.com" className={inputClass} style={{ borderColor: "var(--color-border)" }} />
                <p className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>
                  Must already have a rep account. They will be set as owner immediately.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--color-muted)" }}>Website (optional)</label>
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" className={inputClass} style={{ borderColor: "var(--color-border)" }} />
            </div>
            {createError && <p className="text-xs text-red-600">{createError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="btn-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy ? "Creating…" : ownerMode === "existing" ? "Create & assign" : "Create & invite"}
              </button>
              <button type="button" onClick={() => { setCreating(false); resetForm(); }} className="px-4 py-2 text-sm" style={{ color: "var(--color-muted)" }}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {createOk && <p className="mt-3 text-xs" style={{ color: "#166534" }}>{createOk}</p>}
      </div>

      {/* List */}
      {agencies.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No agencies provisioned yet.</p>
      ) : (
        <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
          {agencies.map((a) => (
            <div key={a.id} className="border-b last:border-0" style={{ borderColor: "var(--color-border)" }}>
              <button
                onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                className="w-full flex items-center justify-between px-5 py-3.5 text-left transition hover:opacity-80"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>{a.name}</span>
                  {a.shortCode && (
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-bg)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                      {a.shortCode}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>{a.memberCount} agent{a.memberCount !== 1 ? "s" : ""}</span>
                  <span className="text-xs" style={{ color: "var(--color-accent)" }}>{expanded === a.id ? "Close" : "Manage →"}</span>
                </div>
              </button>
              {expanded === a.id && <AgencyManager agency={a} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgencyManager({ agency }: { agency: AgencyRow }) {
  const router = useRouter();
  const [members, setMembers] = useState<AgentMember[] | null>(null);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/organisations/${agency.id}/agents`);
    if (res.ok) {
      const data = (await res.json()) as { members: AgentMember[]; pendingInvites: PendingInvite[] };
      setMembers(data.members);
      setPending(data.pendingInvites);
    }
  }, [agency.id]);

  useEffect(() => { void load(); }, [load]);

  async function inviteAgent(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/organisations/${agency.id}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) { setMsg({ kind: "err", text: data.error ?? "Could not send invite." }); return; }
      setMsg({ kind: "ok", text: `Invite sent to ${inviteEmail}.` });
      setInviteEmail("");
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function linkRep(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/agencies/${agency.id}/link-rep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repEmail: linkEmail }),
      });
      const data = (await res.json()) as { error?: string; alreadyMember?: boolean };
      if (!res.ok) { setMsg({ kind: "err", text: data.error ?? "Could not attach rep." }); return; }
      setMsg({ kind: "ok", text: data.alreadyMember ? "Already a member — routing backfilled." : `Attached ${linkEmail} as an agent.` });
      setLinkEmail("");
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 pb-5 pt-1 space-y-5" style={{ background: "var(--color-bg)" }}>
      {/* Members */}
      <div>
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>Agents</p>
        {members === null ? (
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading…</p>
        ) : members.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>No agents have joined yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-2 text-xs" style={{ color: "var(--color-ink)" }}>
                <span>{m.email}</span>
                {m.shortCode && <span className="font-mono text-[10px]" style={{ color: "var(--color-muted)" }}>{m.shortCode}</span>}
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                  {m.memberRole}
                </span>
              </li>
            ))}
          </ul>
        )}
        {pending.length > 0 && (
          <div className="mt-2.5">
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: "var(--color-muted)" }}>Pending invites</p>
            <ul className="space-y-1">
              {pending.map((p) => (
                <li key={p.id} className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {p.email} · expires {fmtDate(p.expiresAt)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <form onSubmit={inviteAgent} className="space-y-2">
          <label className="block text-xs" style={{ color: "var(--color-muted)" }}>Invite a new agent</label>
          <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required type="email" placeholder="agent@agency.com" className={inputClass} style={{ borderColor: "var(--color-border)" }} />
          <button type="submit" disabled={busy} className="btn-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Send invite</button>
        </form>
        <form onSubmit={linkRep} className="space-y-2">
          <label className="block text-xs" style={{ color: "var(--color-muted)" }}>Attach an existing rep</label>
          <input value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} required type="email" placeholder="existing-rep@email.com" className={inputClass} style={{ borderColor: "var(--color-border)" }} />
          <button type="submit" disabled={busy} className="px-3 py-1.5 text-xs font-medium rounded border disabled:opacity-50" style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}>Attach rep</button>
        </form>
      </div>

      {msg && (
        <p className="text-xs" style={{ color: msg.kind === "ok" ? "#166534" : "#991b1b" }}>{msg.text}</p>
      )}
    </div>
  );
}
