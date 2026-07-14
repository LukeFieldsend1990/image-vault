"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AgentShell, inputClass, labelClass } from "./shell";

interface InviteInfo {
  valid: boolean;
  email?: string;
  role?: string;
  reason?: string;
  organisation?: { id: string; name: string; orgType: string; shortCode: string | null } | null;
}

function AgentOnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<"welcome" | "password">("welcome");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setInfo({ valid: false, reason: "Missing invite token." });
      setLoading(false);
      return;
    }
    fetch(`/api/invites/${token}`)
      .then((r) => r.json() as Promise<InviteInfo>)
      .then(setInfo)
      .catch(() => setInfo({ valid: false, reason: "Could not verify this invite." }))
      .finally(() => setLoading(false));
  }, [token]);

  const agency = info?.organisation;
  const isAgentInvite = info?.valid && info.role === "rep" && agency?.orgType === "agency";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const password = fd.get("password") as string;
    const confirm = fd.get("confirm") as string;

    if (password !== confirm) return setError("Passwords do not match");
    if (password.length < 12) return setError("Password must be at least 12 characters");

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: info?.email, password, role: "rep", inviteToken: token }),
      });
      if (res.redirected) {
        router.push(res.url); // → /setup-2fa, then the terms step
        return;
      }
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Could not create your account.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AgentShell step={1} title="Agent setup">
        <p className="text-sm text-[--color-muted]">Verifying your invite…</p>
      </AgentShell>
    );
  }

  if (!isAgentInvite) {
    return (
      <AgentShell step={1} title="Invite unavailable">
        <div
          className="rounded border px-4 py-3 text-xs"
          style={{ borderColor: "#991b1b", background: "rgba(153,27,27,0.06)", color: "#991b1b" }}
        >
          {info?.reason ?? "This link isn't a valid agent invitation, or it has already been used."}
        </div>
        <a href="/login" className="mt-6 inline-block text-xs font-medium text-[--color-ink] underline underline-offset-2">
          ← Back to sign in
        </a>
      </AgentShell>
    );
  }

  if (stage === "welcome") {
    return (
      <AgentShell
        step={1}
        title={`Welcome to ${agency?.name}`}
        subtitle="You've been invited to join as an agent on ImageVault."
      >
        <div
          className="mb-6 rounded border px-4 py-4 text-sm"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
              Agency
            </span>
            {agency?.shortCode && (
              <span className="font-mono text-xs" style={{ color: "var(--color-muted)" }}>{agency.shortCode}</span>
            )}
          </div>
          <p className="mt-1 text-base font-medium text-[--color-ink]">{agency?.name}</p>
        </div>

        <ul className="mb-8 space-y-3 text-sm text-[--color-muted]">
          <li className="flex gap-2.5">
            <span style={{ color: "var(--color-accent)" }}>1.</span>
            Choose a password for your agent account.
          </li>
          <li className="flex gap-2.5">
            <span style={{ color: "var(--color-accent)" }}>2.</span>
            Turn on two-factor authentication (mandatory).
          </li>
          <li className="flex gap-2.5">
            <span style={{ color: "var(--color-accent)" }}>3.</span>
            Accept the agent terms — then you&apos;re in.
          </li>
        </ul>

        <button
          type="button"
          onClick={() => setStage("password")}
          className="btn-accent w-full px-4 py-3.5 text-sm font-medium tracking-wide text-white transition"
        >
          Get started
        </button>
      </AgentShell>
    );
  }

  return (
    <AgentShell
      step={2}
      title="Choose a password"
      subtitle="You'll set up two-factor authentication on the next step."
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label className={labelClass} htmlFor="email">Email</label>
          <input id="email" type="email" readOnly value={info?.email ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            placeholder="12+ characters"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            placeholder="••••••••••••"
            className={inputClass}
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="btn-accent mt-2 w-full px-4 py-3.5 text-sm font-medium tracking-wide text-white transition disabled:opacity-50"
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AgentShell>
  );
}

export default function AgentOnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-[--color-muted]">Loading…</div>
      }
    >
      <AgentOnboardingInner />
    </Suspense>
  );
}
