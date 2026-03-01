"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const ROLES = [
  { value: "talent", label: "Talent", description: "Actor, performer or model storing their own scans" },
  { value: "rep", label: "Representative", description: "Agent or agency managing talent" },
  { value: "licensee", label: "Licensee", description: "Production company licensing scans" },
] as const;

type Role = "talent" | "rep" | "licensee";
const INVITE_REQUIRED: Role[] = ["talent", "rep"];

interface InviteInfo {
  valid: boolean;
  email?: string;
  role?: Role;
  reason?: string;
}

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [inviteLoading, setInviteLoading] = useState(!!inviteToken);
  const [selectedRole, setSelectedRole] = useState<Role | "">("");

  useEffect(() => {
    if (!inviteToken) return;
    setInviteLoading(true);
    fetch(`/api/invites/${inviteToken}`)
      .then((r) => r.json() as Promise<InviteInfo>)
      .then((data) => {
        setInviteInfo(data);
        if (data.valid && data.role) setSelectedRole(data.role);
      })
      .catch(() => setInviteInfo({ valid: false, reason: "Could not verify invite" }))
      .finally(() => setInviteLoading(false));
  }, [inviteToken]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const email = fd.get("email") as string;
    const password = fd.get("password") as string;
    const confirm = fd.get("confirm") as string;
    const role = (fd.get("role") as Role) || selectedRole;

    if (!role) {
      setError("Please select an account type");
      return;
    }

    // Block talent/rep without invite
    if (INVITE_REQUIRED.includes(role) && !inviteToken) {
      setError("This role requires an invitation. Please use the invite link sent to your email.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 12) {
      setError("Password must be at least 12 characters");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role, inviteToken: inviteToken ?? undefined }),
      });

      if (res.redirected) {
        router.push(res.url);
        return;
      }

      const data = await res.json() as { error?: string; redirect?: string };
      if (!res.ok) {
        setError(data.error ?? "Signup failed");
        return;
      }

      router.push(data.redirect ?? "/dashboard");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const emailLocked = inviteInfo?.valid && !!inviteInfo.email;
  const roleLocked = inviteInfo?.valid && !!inviteInfo.role;

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
          <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
            Create account
          </h1>
          <p className="mb-6 text-sm text-[--color-muted]">
            You&apos;ll set up two-factor authentication on the next step.
          </p>

          {/* Invite banners */}
          {inviteLoading && (
            <div
              className="mb-6 rounded border px-4 py-3 text-xs"
              style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
            >
              Verifying invite link…
            </div>
          )}

          {!inviteLoading && inviteToken && inviteInfo?.valid && (
            <div
              className="mb-6 rounded border px-4 py-3 text-xs"
              style={{ borderColor: "#166534", background: "rgba(22,101,52,0.06)", color: "#166534" }}
            >
              You&apos;ve been invited as{" "}
              <strong>{ROLES.find((r) => r.value === inviteInfo.role)?.label ?? inviteInfo.role}</strong>.
              Your email and role have been pre-filled.
            </div>
          )}

          {!inviteLoading && inviteToken && inviteInfo && !inviteInfo.valid && (
            <div
              className="mb-6 rounded border px-4 py-3 text-xs"
              style={{ borderColor: "#991b1b", background: "rgba(153,27,27,0.06)", color: "#991b1b" }}
            >
              {inviteInfo.reason ?? "This invite link is invalid or has expired."}
              {" "}You may still register as a Licensee below.
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            {/* Role selector */}
            <div>
              <label className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-2">
                Account type
              </label>
              <div className="space-y-2">
                {ROLES.map((r) => {
                  const needsInvite = INVITE_REQUIRED.includes(r.value) && !inviteToken;
                  const isDisabled = roleLocked ? r.value !== inviteInfo?.role : needsInvite;
                  return (
                    <label
                      key={r.value}
                      className={`flex items-start gap-3 p-3 border border-[--color-border] transition ${isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:border-[--color-accent]"}`}
                      style={{ borderRadius: "var(--radius)" }}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={r.value}
                        required
                        disabled={isDisabled}
                        checked={roleLocked ? r.value === inviteInfo?.role : selectedRole === r.value}
                        onChange={() => { if (!isDisabled) setSelectedRole(r.value); }}
                        className="mt-0.5 accent-[--color-ink]"
                      />
                      <div>
                        <p className="text-sm font-medium text-[--color-ink]">{r.label}</p>
                        <p className="text-xs text-[--color-muted]">
                          {needsInvite ? "Invitation required" : r.description}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Email */}
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
                readOnly={emailLocked}
                defaultValue={inviteInfo?.email ?? ""}
                placeholder="you@unitedagents.co.uk"
                className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent] read-only:opacity-60 read-only:cursor-not-allowed"
                style={{ borderRadius: "var(--radius)" }}
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                placeholder="12+ characters"
                className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent]"
                style={{ borderRadius: "var(--radius)" }}
              />
            </div>

            {/* Confirm password */}
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
                placeholder="••••••••••••"
                className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent]"
                style={{ borderRadius: "var(--radius)" }}
              />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="btn-accent mt-2 w-full px-4 py-3.5 text-sm font-medium tracking-wide text-white transition disabled:opacity-50"
            >
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="mt-8 text-xs text-[--color-muted]">
            Already have an account?{" "}
            <a
              href="/login"
              className="font-medium text-[--color-ink] underline underline-offset-2"
            >
              Sign in
            </a>
          </p>
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
            Secure by default.
            <br />
            Yours by design.
          </p>
          <p
            className="mt-4 text-sm leading-relaxed"
            style={{ color: "var(--color-sidebar-muted)" }}
          >
            Two-factor authentication is mandatory. Your account and the
            licences granted from it are protected at every step.
          </p>
        </div>
        <div
          className="text-xs"
          style={{ color: "var(--color-sidebar-muted)" }}
        >
          <span className="font-medium" style={{ color: "var(--color-sidebar-fg)" }}>
            Zero-knowledge platform.
          </span>{" "}
          Encryption keys never leave your device. We cannot access your files.
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
