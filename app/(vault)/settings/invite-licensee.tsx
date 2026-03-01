"use client";

import { useState } from "react";

export default function InviteLicensee() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role: "licensee", message: message.trim() || undefined }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) {
        setError(d.error ?? "Failed to send invite");
        return;
      }
      setSuccess(`Invite sent to ${email.trim()}`);
      setEmail("");
      setMessage("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); setSuccess(null); }}
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
      {success && <p className="text-xs" style={{ color: "#166534" }}>{success}</p>}
      <button
        type="submit"
        disabled={loading || !email.trim()}
        className="rounded px-4 py-2 text-xs font-medium text-white transition disabled:opacity-50"
        style={{ background: "var(--color-accent)" }}
      >
        {loading ? "Sending…" : "Send invite"}
      </button>
    </form>
  );
}
