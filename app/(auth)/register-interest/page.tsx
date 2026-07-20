"use client";

import { useState } from "react";
import Wordmark from "@/app/components/wordmark";

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

const PROFESSIONS = [
  "Actor",
  "Stunt Performer",
  "Voice Artist",
  "Musician / Recording Artist",
  "Model",
  "Athlete",
  "Other",
];

const SCAN_STATUS = [
  "Yes — I have scan packages from past productions",
  "No — I haven't been scanned yet",
  "Not sure",
];

type Audience = "talent" | "production";

const inputClass =
  "block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent]";
const labelClass =
  "block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5";

export default function RegisterInterestPage() {
  const [audience, setAudience] = useState<Audience>("talent");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function switchAudience(a: Audience) {
    setAudience(a);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const fd = new FormData(e.currentTarget);
    const body =
      audience === "talent"
        ? {
            role: "talent",
            name: fd.get("name") as string,
            email: fd.get("email") as string,
            profession: fd.get("profession") as string,
            representation: fd.get("representation") as string,
            existingScans: fd.get("existingScans") as string,
            phone: fd.get("phone") as string,
            message: fd.get("message") as string,
          }
        : {
            role: "production",
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
      <div className="flex flex-1 flex-col justify-between px-6 py-8 sm:px-12 sm:py-12 lg:px-16">
        {/* Wordmark + audience toggle */}
        <div>
          <Wordmark variant="lock" className="text-xs" />

          {/* Talent / Production toggle — top middle */}
          <div className="mt-8 flex justify-center">
            <div
              className="inline-flex overflow-hidden border border-[--color-border]"
              style={{ borderRadius: "var(--radius)" }}
              role="tablist"
              aria-label="I am registering as"
            >
              {([["talent", "Talent"], ["production", "Production"]] as [Audience, string][]).map(([a, label]) => {
                const active = audience === a;
                return (
                  <button
                    key={a}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchAudience(a)}
                    className="px-6 py-2 text-xs font-medium tracking-wide uppercase transition"
                    style={
                      active
                        ? { background: "var(--color-accent)", color: "#fff" }
                        : { background: "transparent", color: "var(--color-muted)" }
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Form block */}
        <div className="w-full max-w-sm py-10">
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
                {audience === "talent"
                  ? "Tell us a little about yourself and we'll be in touch to get you set up."
                  : "Tell us about your company and we'll be in touch to get you set up."}
              </p>

              <form key={audience} className="space-y-5" onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="name" className={labelClass}>
                    Full name <span className="text-[--color-accent]">*</span>
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    required
                    placeholder="Jane Smith"
                    className={inputClass}
                    style={{ borderRadius: "var(--radius)" }}
                  />
                </div>

                <div>
                  <label htmlFor="email" className={labelClass}>
                    {audience === "talent" ? "Email" : "Work email"}{" "}
                    <span className="text-[--color-accent]">*</span>
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder={audience === "talent" ? "jane@example.com" : "jane@studio.com"}
                    className={inputClass}
                    style={{ borderRadius: "var(--radius)" }}
                  />
                </div>

                {audience === "talent" ? (
                  <>
                    <div>
                      <label htmlFor="profession" className={labelClass}>
                        You are <span className="text-[--color-accent]">*</span>
                      </label>
                      <select
                        id="profession"
                        name="profession"
                        required
                        defaultValue=""
                        className={inputClass}
                        style={{ borderRadius: "var(--radius)" }}
                      >
                        <option value="" disabled>Select one…</option>
                        {PROFESSIONS.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="representation" className={labelClass}>
                        Representation{" "}
                        <span className="text-[--color-muted] normal-case font-normal">(optional)</span>
                      </label>
                      <input
                        id="representation"
                        name="representation"
                        type="text"
                        placeholder="Agency or manager — or self-represented"
                        className={inputClass}
                        style={{ borderRadius: "var(--radius)" }}
                      />
                    </div>

                    <div>
                      <label htmlFor="existingScans" className={labelClass}>
                        Have you been scanned before? <span className="text-[--color-accent]">*</span>
                      </label>
                      <select
                        id="existingScans"
                        name="existingScans"
                        required
                        defaultValue=""
                        className={inputClass}
                        style={{ borderRadius: "var(--radius)" }}
                      >
                        <option value="" disabled>Select one…</option>
                        {SCAN_STATUS.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label htmlFor="company" className={labelClass}>
                        Company name <span className="text-[--color-accent]">*</span>
                      </label>
                      <input
                        id="company"
                        name="company"
                        type="text"
                        autoComplete="organization"
                        required
                        placeholder="Universal Pictures"
                        className={inputClass}
                        style={{ borderRadius: "var(--radius)" }}
                      />
                    </div>

                    <div>
                      <label htmlFor="companyType" className={labelClass}>
                        Company type <span className="text-[--color-accent]">*</span>
                      </label>
                      <select
                        id="companyType"
                        name="companyType"
                        required
                        defaultValue=""
                        className={inputClass}
                        style={{ borderRadius: "var(--radius)" }}
                      >
                        <option value="" disabled>Select a type…</option>
                        {COMPANY_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div>
                  <label htmlFor="phone" className={labelClass}>
                    Phone <span className="text-[--color-muted] normal-case font-normal">(optional)</span>
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="+44 20 7946 0958"
                    className={inputClass}
                    style={{ borderRadius: "var(--radius)" }}
                  />
                </div>

                <div>
                  <label htmlFor="message" className={labelClass}>
                    Anything else? <span className="text-[--color-muted] normal-case font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={3}
                    placeholder={
                      audience === "talent"
                        ? "Tell us about your work, or what you'd like to protect…"
                        : "Tell us about your production or what you're looking for…"
                    }
                    className={`${inputClass} resize-none`}
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
          &copy; {new Date().getFullYear()} ImageVault. All rights reserved.
        </p>
      </div>

      {/* ── Right panel ── */}
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-16"
        style={{ background: "var(--color-sidebar)" }}
      >
        <div />
        {audience === "talent" ? (
          <div>
            <p
              className="text-3xl font-light leading-snug tracking-tight"
              style={{ color: "var(--color-sidebar-fg)" }}
            >
              Your likeness.
              <br />
              On your terms.
            </p>
            <p
              className="mt-4 text-sm leading-relaxed"
              style={{ color: "var(--color-sidebar-muted)" }}
            >
              ImageVault gives you a secure archive for your scan packages —
              every licence approved by you, every download released under
              dual-custody 2FA, and every access written to an audit trail.
            </p>
          </div>
        ) : (
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
              ImageVault gives production companies secure, audited access to
              talent likeness packages — with dual-custody download controls and
              full chain-of-custody documentation.
            </p>
          </div>
        )}
        <div
          className="text-xs"
          style={{ color: "var(--color-sidebar-muted)" }}
        >
          <span className="font-medium" style={{ color: "var(--color-sidebar-fg)" }}>
            Invite-only platform.
          </span>{" "}
          {audience === "talent"
            ? "Submit your details and our team will be in touch to verify you — or your representation — and set up your vault."
            : "Access is granted by talent or their representation. Submit your details and our team will be in touch to verify your company and facilitate introductions."}
        </div>
      </div>
    </div>
  );
}
