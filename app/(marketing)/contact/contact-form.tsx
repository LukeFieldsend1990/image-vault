"use client";

import { useState } from "react";

const inputClass =
  "block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent]";
const labelClass =
  "block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5";

export default function ContactForm() {
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
      subject: fd.get("subject") as string,
      message: fd.get("message") as string,
      company: fd.get("company") as string, // honeypot
    };

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };

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

  if (submitted) {
    return (
      <div
        className="border p-8"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-surface)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <h2
          className="text-2xl font-semibold tracking-tight"
          style={{ color: "var(--color-ink)" }}
        >
          Message sent.
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>
          Thank you for getting in touch. We&apos;ll reply to you shortly.
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      {/* Honeypot — visually hidden, off the tab order. Bots fill it; humans don't. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

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
          maxLength={200}
          placeholder="Jane Smith"
          className={inputClass}
          style={{ borderRadius: "var(--radius)" }}
        />
      </div>

      <div>
        <label htmlFor="email" className={labelClass}>
          Email <span className="text-[--color-accent]">*</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="jane@example.com"
          className={inputClass}
          style={{ borderRadius: "var(--radius)" }}
        />
      </div>

      <div>
        <label htmlFor="subject" className={labelClass}>
          Subject
        </label>
        <input
          id="subject"
          name="subject"
          type="text"
          maxLength={200}
          placeholder="How can we help?"
          className={inputClass}
          style={{ borderRadius: "var(--radius)" }}
        />
      </div>

      <div>
        <label htmlFor="message" className={labelClass}>
          Message <span className="text-[--color-accent]">*</span>
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={6}
          maxLength={5000}
          placeholder="Tell us a little about your enquiry…"
          className={`${inputClass} resize-y`}
          style={{ borderRadius: "var(--radius)" }}
        />
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--color-accent)" }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="btn-accent px-6 py-3 text-xs font-medium tracking-wide uppercase text-white transition disabled:opacity-50"
      >
        {loading ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
