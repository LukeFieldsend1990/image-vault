"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Rep {
  id: string;
  repId: string;
  email: string;
  createdAt: number;
}

interface PendingInvite {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "used" | "expired";
}

export default function DelegationClient() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Invite new rep state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);

  async function load() {
    try {
      const r = await fetch("/api/delegation");
      const d = await r.json() as { reps?: Rep[] };
      setReps(d.reps ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  const loadInvites = useCallback(async () => {
    setInvitesLoading(true);
    try {
      const r = await fetch("/api/invites?role=rep");
      const d = await r.json() as { invites?: PendingInvite[] };
      setPendingInvites((d.invites ?? []).filter((i) => i.status === "pending"));
    } catch {
      // ignore
    } finally {
      setInvitesLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadInvites();
  }, [loadInvites]);

  async function addRep(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setAddError(null);
    setAdding(true);
    try {
      const res = await fetch("/api/delegation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed");
      setEmail("");
      await load();
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : "Failed");
    } finally {
      setAdding(false);
    }
  }

  async function removeRep(repId: string) {
    setRemovingId(repId);
    try {
      await fetch(`/api/delegation/${repId}`, { method: "DELETE" });
      setReps((prev) => prev.filter((r) => r.repId !== repId));
    } finally {
      setRemovingId(null);
    }
  }

  async function sendRepInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteError(null);
    setInviteSuccess(null);
    setInviting(true);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: "rep" }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) {
        setInviteError(d.error ?? "Failed to send invite");
        return;
      }
      setInviteSuccess(`Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
      await loadInvites();
    } catch {
      setInviteError("Network error. Please try again.");
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(id: string) {
    if (!confirm("Cancel this invite?")) return;
    await fetch(`/api/invites/${id}`, { method: "DELETE" });
    await loadInvites();
  }

  return (
    <div className="p-8 max-w-lg">
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1.5 text-xs"
        style={{ color: "var(--color-muted)" }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Account settings
      </Link>

      <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--color-ink)" }}>
        Representatives
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-muted)" }}>
        Grant your agency or manager access to upload and manage your vault on your behalf.
      </p>

      {/* Invite new rep */}
      <div
        className="rounded border p-5 mb-6"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
          Invite New Representative
        </h2>
        <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
          Send an invite link to someone who doesn&apos;t have an account yet. They&apos;ll be automatically linked to your vault on signup.
        </p>
        <form onSubmit={sendRepInvite} className="flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null); setInviteSuccess(null); }}
            placeholder="rep@agency.com"
            className="flex-1 rounded border px-3 py-2 text-xs outline-none focus:ring-1"
            style={{
              borderColor: inviteError ? "var(--color-danger)" : "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-ink)",
            }}
          />
          <button
            type="submit"
            disabled={inviting || !inviteEmail.trim()}
            className="rounded px-4 py-2 text-xs font-medium text-white transition disabled:opacity-60"
            style={{ background: "var(--color-accent)" }}
          >
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </form>
        {inviteError && <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>{inviteError}</p>}
        {inviteSuccess && <p className="mt-2 text-xs" style={{ color: "#166534" }}>{inviteSuccess}</p>}

        {/* Pending invites */}
        {!invitesLoading && pendingInvites.length > 0 && (
          <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
              Pending invites
            </p>
            <ul className="space-y-2">
              {pendingInvites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between text-xs">
                  <div>
                    <span style={{ color: "var(--color-ink)" }}>{inv.email}</span>
                    <span className="ml-2" style={{ color: "var(--color-muted)" }}>
                      expires {new Date(inv.expiresAt * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                  <button
                    onClick={() => revokeInvite(inv.id)}
                    className="text-xs transition hover:opacity-70"
                    style={{ color: "var(--color-danger)" }}
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Add existing rep by email */}
      <div
        className="rounded border p-5 mb-6"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
          Link Existing Representative
        </h2>
        <form onSubmit={addRep} className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setAddError(null); }}
            placeholder="rep@agency.com"
            className="flex-1 rounded border px-3 py-2 text-xs outline-none focus:ring-1"
            style={{
              borderColor: addError ? "var(--color-danger)" : "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-ink)",
            }}
          />
          <button
            type="submit"
            disabled={adding || !email.trim()}
            className="rounded px-4 py-2 text-xs font-medium text-white transition disabled:opacity-60"
            style={{ background: "var(--color-accent)" }}
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </form>
        {addError && (
          <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>{addError}</p>
        )}
        <p className="mt-2 text-xs" style={{ color: "var(--color-muted)" }}>
          The rep must already have an account registered as a Representative.
        </p>
      </div>

      {/* Rep list */}
      <div
        className="rounded border"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Current Representatives
          </h2>
        </div>

        {loading ? (
          <p className="px-5 pb-5 text-xs" style={{ color: "var(--color-muted)" }}>Loading…</p>
        ) : reps.length === 0 ? (
          <p className="px-5 pb-5 text-xs" style={{ color: "var(--color-muted)" }}>
            No representatives linked yet.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {reps.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>{r.email}</p>
                  <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                    Added {new Date(r.createdAt * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <button
                  onClick={() => removeRep(r.repId)}
                  disabled={removingId === r.repId}
                  className="text-xs transition disabled:opacity-40"
                  style={{ color: "var(--color-danger)" }}
                >
                  {removingId === r.repId ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
