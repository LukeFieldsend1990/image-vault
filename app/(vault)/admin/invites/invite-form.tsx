"use client";

import { useState, useEffect, useCallback } from "react";

interface Invite {
  id: string;
  email: string;
  role: "talent" | "rep" | "licensee";
  invitedByEmail: string | null;
  message: string | null;
  status: "pending" | "used" | "expired";
  expiresAt: number;
  createdAt: number;
  usedAt: number | null;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "#d97706",
  used: "#166534",
  expired: "#6b7280",
};

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function InviteManager() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [tableLoading, setTableLoading] = useState(true);

  // Create form state
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"talent" | "rep" | "licensee">("talent");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadInvites = useCallback(async () => {
    setTableLoading(true);
    try {
      const r = await fetch("/api/invites");
      const d = await r.json() as { invites?: Invite[] };
      setInvites(d.invites ?? []);
    } catch {
      // ignore
    } finally {
      setTableLoading(false);
    }
  }, []);

  useEffect(() => { void loadInvites(); }, [loadInvites]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setInviteLink(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role, message: message.trim() || undefined }),
      });
      const d = await res.json() as { error?: string; inviteId?: string };
      if (!res.ok) {
        setFormError(d.error ?? "Failed to send invite");
        return;
      }
      setFormSuccess(`Invite sent to ${email.trim()}`);
      setInviteLink(`${window.location.origin}/signup?invite=${d.inviteId}`);
      setEmail("");
      setMessage("");
      await loadInvites();
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function copyLink() {
    if (!inviteLink) return;
    void navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function revokeInvite(id: string) {
    if (!confirm("Revoke this invite?")) return;
    await fetch(`/api/invites/${id}`, { method: "DELETE" });
    await loadInvites();
  }

  return (
    <>
      {/* Create invite form */}
      <div
        className="rounded border p-6 mb-8"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "var(--color-muted)" }}>
          Send Invitation
        </h2>

        <form onSubmit={handleCreate} className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--color-muted)" }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="invitee@example.com"
                className="w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
              />
            </div>

            <div className="w-36">
              <label className="block text-xs font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--color-muted)" }}>
                Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                className="w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
              >
                <option value="talent">Talent</option>
                <option value="rep">Representative</option>
                <option value="licensee">Licensee</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--color-muted)" }}>
              Personal message <span style={{ color: "var(--color-border)" }}>(optional)</span>
            </label>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Welcome to Image Vault…"
              className="w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
            />
          </div>

          {formError && <p className="text-xs" style={{ color: "var(--color-danger)" }}>{formError}</p>}
          {formSuccess && <p className="text-xs" style={{ color: "#166534" }}>{formSuccess}</p>}

          <button
            type="submit"
            disabled={submitting || !email.trim()}
            className="rounded px-5 py-2 text-xs font-medium text-white transition disabled:opacity-50"
            style={{ background: "var(--color-accent)" }}
          >
            {submitting ? "Sending…" : "Send invite"}
          </button>
        </form>

        {inviteLink && (
          <div
            className="mt-4 rounded border p-3 space-y-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
              Share this link directly:
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={inviteLink}
                className="min-w-0 flex-1 rounded border px-2.5 py-1.5 text-xs font-mono outline-none"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)" }}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={copyLink}
                className="flex-shrink-0 rounded px-3 py-1.5 text-xs font-medium transition"
                style={{ background: copied ? "#166534" : "var(--color-accent)", color: "#fff" }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-[10px]" style={{ color: "var(--color-muted)" }}>
              Valid for 7 days · pre-fills sign-up with email and role
            </p>
          </div>
        )}
      </div>

      {/* Invite table */}
      <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[700px]"
          style={{
            gridTemplateColumns: "2fr 1fr 1fr 1.5fr 1fr 80px",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Email</span>
          <span>Role</span>
          <span>Status</span>
          <span>Invited by</span>
          <span>Expires</span>
          <span />
        </div>

        {tableLoading && (
          <p className="px-5 py-6 text-xs" style={{ color: "var(--color-muted)" }}>Loading…</p>
        )}

        {!tableLoading && invites.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>No invites yet.</p>
        )}

        {!tableLoading && invites.map((r) => (
          <div
            key={r.id}
            className="grid items-center px-5 py-3.5 border-b last:border-0 text-sm min-w-[700px]"
            style={{
              gridTemplateColumns: "2fr 1fr 1fr 1.5fr 1fr 80px",
              borderColor: "var(--color-border)",
            }}
          >
            <span className="text-xs font-medium truncate" style={{ color: "var(--color-ink)" }}>{r.email}</span>

            <span className="text-xs capitalize" style={{ color: "var(--color-muted)" }}>{r.role}</span>

            <span>
              <span
                className="inline-flex items-center text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
                style={{
                  background: `${STATUS_COLOR[r.status]}18`,
                  color: STATUS_COLOR[r.status],
                }}
              >
                {r.status}
              </span>
            </span>

            <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
              {r.invitedByEmail ?? "—"}
            </span>

            <span className="text-xs" style={{ color: "var(--color-muted)" }}>{ts(r.expiresAt)}</span>

            <span>
              {r.status === "pending" && (
                <button
                  onClick={() => revokeInvite(r.id)}
                  className="text-[10px] font-medium transition hover:opacity-70"
                  style={{ color: "var(--color-danger)" }}
                >
                  Revoke
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
