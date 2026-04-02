"use client";

import { useState } from "react";

export default function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess(false);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const currentPassword = fd.get("currentPassword") as string;
    const newPassword = fd.get("newPassword") as string;
    const confirm = fd.get("confirm") as string;

    if (newPassword !== confirm) {
      setError("New passwords do not match");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json() as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Failed to change password");
        return;
      }

      setSuccess(true);
      setOpen(false);
      (e.target as HTMLFormElement).reset();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-sm" style={{ color: "var(--color-muted)" }}>
          {success ? (
            <span style={{ color: "var(--color-ink)" }}>Password updated successfully.</span>
          ) : (
            "Change password"
          )}
        </span>
        <button
          onClick={() => { setOpen(true); setSuccess(false); setError(""); }}
          className="text-xs font-medium underline underline-offset-2"
          style={{ color: "var(--color-ink)" }}
        >
          {success ? "Change again" : "Change"}
        </button>
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <div>
        <label htmlFor="currentPassword" className="block text-xs font-medium tracking-wide uppercase mb-1" style={{ color: "var(--color-muted)" }}>
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className="block w-full border bg-white px-3 py-2 text-sm outline-none transition focus:border-[--color-accent]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-ink)", borderRadius: "var(--radius)" }}
        />
      </div>
      <div>
        <label htmlFor="newPassword" className="block text-xs font-medium tracking-wide uppercase mb-1" style={{ color: "var(--color-muted)" }}>
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          placeholder="Min. 12 characters"
          className="block w-full border bg-white px-3 py-2 text-sm outline-none transition focus:border-[--color-accent]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-ink)", borderRadius: "var(--radius)" }}
        />
      </div>
      <div>
        <label htmlFor="confirm" className="block text-xs font-medium tracking-wide uppercase mb-1" style={{ color: "var(--color-muted)" }}>
          Confirm new password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className="block w-full border bg-white px-3 py-2 text-sm outline-none transition focus:border-[--color-accent]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-ink)", borderRadius: "var(--radius)" }}
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={loading}
          className="btn-accent px-4 py-2 text-xs font-medium text-white transition disabled:opacity-50"
        >
          {loading ? "Updating…" : "Update password"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(""); }}
          className="text-xs"
          style={{ color: "var(--color-muted)" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
