"use client";

import { useState } from "react";

const COMPANY_TYPES = [
  "Production Company",
  "Studio",
  "Network / Broadcaster",
  "Independent Producer",
  "Post-Production",
  "VFX / Visual Effects",
  "Games / Interactive",
  "Advertising Agency",
  "Other",
];

export default function RegisterInterestPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const fd = new FormData(e.currentTarget);
    const body = {
      name: fd.get("name") as string,
      email: fd.get("email") as string,
      company: fd.get("company") as string,
      companyType: fd.get("companyType") as string,
      phone: fd.get("phone") as string,
      message: fd.get("message") as string,
    };

    try {
      const res = await fetch("/api/auth/register-interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      setSubmitted(true);
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
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[--color-ink]">
            Image Vault
          </span>
        </div>

        {/* Form block */}
        <div className="w-full max-w-sm">
          {submitted ? (
            <div>
              <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
                Request received.
              </h1>
              <p className="mb-10 text-sm text-[--color-muted]">
                Thank you for your interest. Our team will be in touch shortly.
              </p>
              <a
                href="/login"
                className="text-xs text-[--color-muted] hover:text-[--color-ink] transition underline underline-offset-2"
              >
                ← Back to sign in
              </a>
            </div>
          ) : (
            <>
              <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
                Request access
              </h1>
              <p className="mb-10 text-sm text-[--color-muted]">
                Tell us about your company and we&apos;ll be in touch to get you set up.
              </p>

              <form className="space-y-5" onSubmit={handleSubmit}>
                <div>
                  <label
                    htmlFor="name"
                    className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
                  >
                    Full name <span className="text-[--color-accent]">*</span>
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    required
                    placeholder="Jane Smith"
                    className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent]"
                    style={{ borderRadius: "var(--radius)" }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
                  >
                    Work email <span className="text-[--color-accent]">*</span>
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="jane@studio.com"
                    className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent]"
                    style={{ borderRadius: "var(--radius)" }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="company"
                    className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
                  >
                    Company name <span className="text-[--color-accent]">*</span>
                  </label>
                  <input
                    id="company"
                    name="company"
                    type="text"
                    autoComplete="organization"
                    required
                    placeholder="Universal Pictures"
                    className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent]"
                    style={{ borderRadius: "var(--radius)" }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="companyType"
                    className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
                  >
                    Company type <span className="text-[--color-accent]">*</span>
                  </label>
                  <select
                    id="companyType"
                    name="companyType"
                    required
                    defaultValue=""
                    className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] outline-none transition focus:border-[--color-accent]"
                    style={{ borderRadius: "var(--radius)" }}
                  >
                    <option value="" disabled>Select a type…</option>
                    {COMPANY_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="phone"
                    className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
                  >
                    Phone <span className="text-[--color-muted] normal-case font-normal">(optional)</span>
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="+44 20 7946 0958"
                    className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent]"
                    style={{ borderRadius: "var(--radius)" }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="message"
                    className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
                  >
                    Anything else? <span className="text-[--color-muted] normal-case font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={3}
                    placeholder="Tell us about your production or what you're looking for…"
                    className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent] resize-none"
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
                  {loading ? "Sending…" : "Submit request"}
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
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-xs text-[--color-muted]">
          &copy; {new Date().getFullYear()} Image Vault. All rights reserved.
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
            Licensed access.
            <br />
            On your terms.
          </p>
          <p
            className="mt-4 text-sm leading-relaxed"
            style={{ color: "var(--color-sidebar-muted)" }}
          >
            Image Vault gives production companies secure, audited access to
            talent likeness packages — with dual-custody download controls and
            full chain-of-custody documentation.
          </p>
        </div>
        <div
          className="text-xs"
          style={{ color: "var(--color-sidebar-muted)" }}
        >
          <span className="font-medium" style={{ color: "var(--color-sidebar-fg)" }}>
            Invite-only platform.
          </span>{" "}
          Access is granted by talent or their representation. Submit your
          details and our team will be in touch to verify your company and
          facilitate introductions.
        </div>
      </div>
    </div>
  );
}
