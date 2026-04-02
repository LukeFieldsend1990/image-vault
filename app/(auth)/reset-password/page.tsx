"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const password = fd.get("password") as string;
    const confirm = fd.get("confirm") as string;

    if (password !== confirm) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    if (password.length < 12) {
      setError("Password must be at least 12 characters");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json() as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Reset failed");
        return;
      }

      setSuccess(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-[--color-ink] mb-2">Invalid link</h1>
          <p className="text-sm text-[--color-muted] mb-4">This password reset link is missing or malformed.</p>
          <a href="/forgot-password" className="text-xs font-medium text-[--color-ink] underline underline-offset-2">
            Request a new link
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* ── Left panel ── */}
      <div className="flex flex-1 flex-col justify-between px-12 py-12 lg:px-16">
        {/* Wordmark */}
        <div>
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[--color-muted]">
            United Agents
          </span>
          <span className="mx-2 text-xs" style={{ color: "var(--color-accent)" }}>/</span>
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[--color-ink]">
            Image Vault
          </span>
        </div>

        {/* Form block */}
        <div className="w-full max-w-sm">
          {success ? (
            <>
              <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
                Password updated
              </h1>
              <p className="mb-10 text-sm text-[--color-muted]">
                Your password has been reset. You can now sign in with your new password.
              </p>
              <button
                onClick={() => router.push("/login")}
                className="btn-accent w-full px-4 py-3.5 text-sm font-medium tracking-wide text-white transition"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
                Choose new password
              </h1>
              <p className="mb-10 text-sm text-[--color-muted]">
                Enter a new password for your account. Minimum 12 characters.
              </p>

              <form className="space-y-5" onSubmit={handleSubmit}>
                <div>
                  <label
                    htmlFor="password"
                    className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
                  >
                    New password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    placeholder="••••••••••••"
                    className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent]"
                    style={{ borderRadius: "var(--radius)" }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="confirm"
                    className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
                  >
                    Confirm password
                  </label>
                  <input
                    id="confirm"
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    placeholder="••••••••••••"
                    className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent]"
                    style={{ borderRadius: "var(--radius)" }}
                  />
                </div>

                {error && (
                  <p className="text-xs text-red-600">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-accent mt-2 w-full px-4 py-3.5 text-sm font-medium tracking-wide text-white transition disabled:opacity-50"
                >
                  {loading ? "Resetting…" : "Reset password"}
                </button>
              </form>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-xs text-[--color-muted]">
          &copy; {new Date().getFullYear()} United Agents. All rights reserved.
        </p>
      </div>

      {/* ── Right panel ── */}
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-16"
        style={{ background: "var(--color-sidebar)" }}
      >
        <div />
        <div>
          <p
            className="text-3xl font-light leading-snug tracking-tight"
            style={{ color: "var(--color-sidebar-fg)" }}
          >
            Your likeness.
            <br />
            Your terms.
          </p>
          <p
            className="mt-4 text-sm leading-relaxed"
            style={{ color: "var(--color-sidebar-muted)" }}
          >
            A private, encrypted vault for talent to store, manage, and
            license high-fidelity likeness scans — with full control over
            who accesses them and when.
          </p>
        </div>
        <div
          className="text-xs"
          style={{ color: "var(--color-sidebar-muted)" }}
        >
          <span className="font-medium" style={{ color: "var(--color-sidebar-fg)" }}>
            End-to-end encrypted.
          </span>{" "}
          Files are encrypted in your browser before upload. The platform never
          holds your plaintext data.
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-[--color-muted]">Loading…</div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
