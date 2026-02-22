"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Step = "credentials" | "totp";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/dashboard";

  const [step, setStep] = useState<Step>("credentials");
  const [pendingToken, setPendingToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCredentials(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const email = fd.get("email") as string;
    const password = fd.get("password") as string;

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as { error?: string; redirect?: string; pendingToken?: string };

      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }

      if (data.redirect) {
        router.push(data.redirect);
        return;
      }

      setPendingToken(data.pendingToken ?? "");
      setStep("totp");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const code = (fd.get("code") as string).replace(/\s/g, "");

    try {
      const res = await fetch("/api/auth/login/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, code }),
      });
      const data = await res.json() as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Verification failed");
        return;
      }

      router.push(nextPath);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
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
          {step === "credentials" ? (
            <>
              <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
                Sign in
              </h1>
              <p className="mb-10 text-sm text-[--color-muted]">
                Access your secure likeness vault.
              </p>

              <form className="space-y-5" onSubmit={handleCredentials}>
                <div>
                  <label
                    htmlFor="email"
                    className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@unitedagents.co.uk"
                    className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent]"
                    style={{ borderRadius: "var(--radius)" }}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="password"
                      className="block text-xs font-medium tracking-wide uppercase text-[--color-muted]"
                    >
                      Password
                    </label>
                    <a
                      href="/forgot-password"
                      className="text-xs text-[--color-muted] hover:text-[--color-ink] transition"
                    >
                      Forgot password?
                    </a>
                  </div>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
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
                  {loading ? "Signing in…" : "Sign in"}
                </button>
              </form>

              <p className="mt-8 text-xs text-[--color-muted]">
                Don&apos;t have an account?{" "}
                <a
                  href="/signup"
                  className="font-medium text-[--color-ink] underline underline-offset-2"
                >
                  Request access
                </a>
              </p>
            </>
          ) : (
            <>
              <button
                onClick={() => { setStep("credentials"); setError(""); }}
                className="mb-8 flex items-center gap-1.5 text-xs text-[--color-muted] hover:text-[--color-ink] transition"
              >
                ← Back
              </button>

              <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
                Two-factor auth
              </h1>
              <p className="mb-10 text-sm text-[--color-muted]">
                Enter the 6-digit code from your authenticator app.
              </p>

              <form className="space-y-5" onSubmit={handleTotp}>
                <div>
                  <label
                    htmlFor="code"
                    className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
                  >
                    Authentication code
                  </label>
                  <input
                    id="code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    placeholder="000 000"
                    maxLength={7}
                    className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-ink] tracking-widest text-center"
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
                  {loading ? "Verifying…" : "Verify"}
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

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-[--color-muted]">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}
