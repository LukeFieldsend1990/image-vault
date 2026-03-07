"use client";

import { useState } from "react";

export default function InviteLicensee() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setInviteLink(null);
    setLoading(true);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role: "licensee", message: message.trim() || undefined }),
      });
      const d = await res.json() as { error?: string; inviteId?: string };
      if (!res.ok) {
        setError(d.error ?? "Failed to send invite");
        return;
      }
      setInviteLink(`${window.location.origin}/signup?invite=${d.inviteId}`);
      setEmail("");
      setMessage("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function copyLink() {
    if (!inviteLink) return;
    void navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(null); setInviteLink(null); }}
            placeholder="licensee@studio.com"
            required
            className="w-full rounded border px-3 py-2 text-xs outline-none focus:ring-1"
            style={{
              borderColor: error ? "var(--color-danger)" : "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-ink)",
            }}
          />
        </div>
        <div>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Optional message…"
            className="w-full rounded border px-3 py-2 text-xs outline-none focus:ring-1"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-ink)",
            }}
          />
        </div>
        {error && <p className="text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <button
          type="submit"
          disabled={loading || !email.trim()}
          className="rounded px-4 py-2 text-xs font-medium text-white transition disabled:opacity-50"
          style={{ background: "var(--color-accent)" }}
        >
          {loading ? "Sending…" : "Send invite"}
        </button>
      </form>

      {inviteLink && (
        <div
          className="rounded border p-3 space-y-2"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
            Invite sent — share this link directly:
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={inviteLink}
              className="min-w-0 flex-1 rounded border px-2.5 py-1.5 text-xs font-mono outline-none"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-muted)" }}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              onClick={copyLink}
              className="flex-shrink-0 rounded px-3 py-1.5 text-xs font-medium transition"
              style={{
                background: copied ? "#166534" : "var(--color-accent)",
                color: "#fff",
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-[10px]" style={{ color: "var(--color-muted)" }}>
            Valid for 7 days · pre-fills the sign-up form with email and role
          </p>
        </div>
      )}
    </div>
  );
}
