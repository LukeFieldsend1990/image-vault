"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface StatusData {
  step: string | null;
  downloadTokens?: Array<{ fileId: string; filename: string; token: string }>;
}

export default function TalentAuthoriseClient({ licenceId }: { licenceId: string }) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/licences/${licenceId}/download/status`)
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => setStatus({ step: null }));
  }, [licenceId]);

  async function submit() {
    if (!code.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/licences/${licenceId}/download/talent-2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.replace(/\s/g, "") }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Invalid code");
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
      setCode(""); // clear so they must re-enter a fresh code
    } finally {
      setSubmitting(false);
    }
  }

  if (status === null) {
    return <div className="p-8 text-sm" style={{ color: "var(--color-muted)" }}>Loading…</div>;
  }

  if (status.step === null || status.step === "expired") {
    return (
      <div className="p-8 max-w-lg">
        <Link href="/vault/authorise" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </Link>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No active download session for this licence, or the session has expired.
        </p>
      </div>
    );
  }

  if (status.step === "awaiting_licensee") {
    return (
      <div className="p-8 max-w-lg">
        <Link href="/vault/authorise" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </Link>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Waiting for the licensee to complete their verification first.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="p-8 max-w-lg">
        <div
          className="rounded border p-6 text-center"
          style={{ borderColor: "var(--color-border)", background: "#f0fdf4" }}
        >
          <svg className="mx-auto mb-3" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="text-sm font-medium" style={{ color: "#166534" }}>
            Authorisation complete
          </p>
          <p className="mt-1 text-xs" style={{ color: "#166534" }}>
            The licensee can now download the files.
          </p>
        </div>
        <Link
          href="/vault/licences"
          className="mt-4 block text-center text-xs underline"
          style={{ color: "var(--color-muted)" }}
        >
          View licences
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-lg">
      <Link href="/vault/authorise" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        Back
      </Link>

      <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--color-ink)" }}>
        Authorise Download
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-muted)" }}>
        A production company has completed their verification and is requesting your approval to download this scan package. Enter your authenticator code to authorise.
      </p>

      <div
        className="rounded border p-6"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink)" }}>
          Enter your authenticator code
        </p>
        <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
          Open your authenticator app and enter the 6-digit code for Image Vault.
        </p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setError(null); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="000 000"
          className="w-full rounded border px-3 py-2.5 text-center text-xl font-mono tracking-[0.3em] outline-none focus:ring-1"
          style={{ borderColor: error ? "var(--color-danger)" : "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
        />
        {error && (
          <div className="mt-2 rounded px-3 py-2 text-xs font-medium" style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-danger)" }}>
            {error} — please wait for a new code and try again.
          </div>
        )}
        <button
          onClick={submit}
          disabled={submitting || code.length < 6}
          className="mt-4 w-full rounded py-2.5 text-sm font-medium text-white transition disabled:opacity-60"
          style={{ background: "var(--color-accent)" }}
        >
          {submitting ? "Verifying…" : "Authorise Download"}
        </button>
      </div>
    </div>
  );
}
