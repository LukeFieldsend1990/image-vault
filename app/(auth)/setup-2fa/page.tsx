"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";

function Setup2faInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [code, setCode] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("Missing setup token. Please sign up again.");
      return;
    }

    fetch(`/api/auth/setup-2fa?token=${encodeURIComponent(token)}`)
      .then((r) => r.json() as Promise<{ otpauthUrl?: string; secret?: string; error?: string }>)
      .then((data) => {
        if (data.error) {
          setLoadError(data.error);
        } else {
          setOtpauthUrl(data.otpauthUrl ?? "");
          setSecret(data.secret ?? "");
          setLoaded(true);
        }
      })
      .catch(() => setLoadError("Network error. Please refresh."));
  }, [token]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");
    setVerifying(true);

    try {
      const res = await fetch("/api/auth/setup-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.replace(/\s/g, "") }),
      });
      const data = await res.json() as { error?: string };

      if (!res.ok) {
        setSubmitError(data.error ?? "Verification failed");
        return;
      }

      router.push("/dashboard");
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setVerifying(false);
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

        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
            Set up authenticator
          </h1>
          <p className="mb-10 text-sm text-[--color-muted]">
            Scan the QR code with Google Authenticator, Authy, or any TOTP app.
          </p>

          {!loaded && !loadError && (
            <p className="text-sm text-[--color-muted]">Loading…</p>
          )}

          {loadError && (
            <div className="space-y-4">
              <p className="text-sm text-red-600">{loadError}</p>
              <a
                href="/signup"
                className="text-xs font-medium text-[--color-ink] underline underline-offset-2"
              >
                ← Back to sign up
              </a>
            </div>
          )}

          {loaded && (
            <>
              {/* QR Code */}
              <div className="mb-8 flex flex-col items-start gap-4">
                <div
                  className="border border-[--color-border] p-3 inline-block"
                  style={{ borderRadius: "var(--radius)" }}
                >
                  <QRCodeSVG
                    value={otpauthUrl}
                    size={160}
                    bgColor="#ffffff"
                    fgColor="#000000"
                    level="M"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="text-xs text-[--color-muted] hover:text-[--color-ink] transition underline underline-offset-2"
                >
                  {showSecret ? "Hide key" : "Can't scan? Enter key manually"}
                </button>

                {showSecret && (
                  <div className="w-full">
                    <p className="text-xs text-[--color-muted] mb-1.5 uppercase tracking-wide font-medium">
                      Manual entry key
                    </p>
                    <code
                      className="block w-full break-all border border-[--color-border] bg-zinc-50 px-4 py-3 text-xs font-mono text-[--color-ink] select-all"
                      style={{ borderRadius: "var(--radius)" }}
                    >
                      {secret.match(/.{1,4}/g)?.join(" ") ?? secret}
                    </code>
                  </div>
                )}
              </div>

              {/* Verify form */}
              <form className="space-y-5" onSubmit={handleVerify}>
                <div>
                  <label
                    htmlFor="code"
                    className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
                  >
                    Verification code
                  </label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    placeholder="000 000"
                    maxLength={7}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent] tracking-widest text-center"
                    style={{ borderRadius: "var(--radius)" }}
                  />
                </div>

                {submitError && (
                  <p className="text-xs text-red-600">{submitError}</p>
                )}

                <button
                  type="submit"
                  disabled={verifying}
                  className="btn-accent mt-2 w-full px-4 py-3.5 text-sm font-medium tracking-wide text-white transition disabled:opacity-50"
                >
                  {verifying ? "Verifying…" : "Verify and continue"}
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
            One more step.
            <br />
            Permanently secure.
          </p>
          <p
            className="mt-4 text-sm leading-relaxed"
            style={{ color: "var(--color-sidebar-muted)" }}
          >
            Every login requires a second factor. Your authenticator app generates
            a time-based code that no one else can replicate.
          </p>
        </div>
        <div className="text-xs" style={{ color: "var(--color-sidebar-muted)" }}>
          <span className="font-medium" style={{ color: "var(--color-sidebar-fg)" }}>
            Use any TOTP app.
          </span>{" "}
          Google Authenticator, Authy, 1Password, Bitwarden — all work.
        </div>
      </div>
    </div>
  );
}

export default function Setup2faPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-[--color-muted]">Loading…</div>}>
      <Setup2faInner />
    </Suspense>
  );
}
