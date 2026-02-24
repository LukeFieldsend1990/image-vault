"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

type Step = "idle" | "awaiting_licensee" | "awaiting_talent" | "complete" | "expired" | "error";

interface DownloadToken {
  fileId: string;
  filename: string;
  token: string;
}

const STEP_LABELS: Record<Step, string> = {
  idle: "Initiating…",
  awaiting_licensee: "Step 1 — Verify your identity",
  awaiting_talent: "Step 2 — Awaiting talent approval",
  complete: "Ready to download",
  expired: "Session expired",
  error: "Error",
};

export default function DualCustodyDownloadClient({ licenceId }: { licenceId: string }) {
  const [step, setStep] = useState<Step>("idle");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<DownloadToken[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initiate the dual-custody session on mount
  useEffect(() => {
    fetch(`/api/licences/${licenceId}/download/initiate`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => setStep(d.step ?? "error"))
      .catch(() => setStep("error"));
  }, [licenceId]);

  // Poll for status while awaiting talent
  useEffect(() => {
    if (step === "awaiting_talent") {
      pollRef.current = setInterval(async () => {
        const r = await fetch(`/api/licences/${licenceId}/download/status`);
        const d = await r.json();
        if (d.step === "complete") {
          setTokens(d.downloadTokens ?? []);
          setStep("complete");
          clearInterval(pollRef.current!);
        } else if (d.step === "expired" || d.step === null) {
          setStep("expired");
          clearInterval(pollRef.current!);
        }
      }, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, licenceId]);

  async function submitCode() {
    if (!code.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/licences/${licenceId}/download/licensee-2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.replace(/\s/g, "") }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Invalid code");
      setStep(d.step ?? "error");
      setCode("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  const stepIndex = ["awaiting_licensee", "awaiting_talent", "complete"].indexOf(step);

  return (
    <div className="p-8 max-w-lg">
      <Link href="/licences" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        My Licences
      </Link>

      <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--color-ink)" }}>Dual-Custody Download</h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-muted)" }}>
        Both you and the talent must complete identity verification before files can be downloaded.
      </p>

      {/* Step indicator */}
      {step !== "idle" && step !== "error" && step !== "expired" && (
        <div className="mb-8 flex items-center gap-3">
          {["Verify identity", "Talent approval", "Download"].map((label, i) => (
            <div key={label} className="flex items-center gap-3">
              <div className="flex flex-col items-center">
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    background: i <= stepIndex ? "var(--color-accent)" : "var(--color-border)",
                    color: i <= stepIndex ? "#fff" : "var(--color-muted)",
                  }}
                >
                  {i < stepIndex ? "✓" : i + 1}
                </div>
                <span className="mt-1 text-[10px] text-center w-14 leading-tight" style={{ color: i === stepIndex ? "var(--color-ink)" : "var(--color-muted)" }}>
                  {label}
                </span>
              </div>
              {i < 2 && <div className="mb-4 h-px w-8 flex-shrink-0" style={{ background: i < stepIndex ? "var(--color-accent)" : "var(--color-border)" }} />}
            </div>
          ))}
        </div>
      )}

      {/* Step content */}
      {step === "idle" && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>Initiating session…</p>
      )}

      {step === "awaiting_licensee" && (
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
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && submitCode()}
            placeholder="000 000"
            className="w-full rounded border px-3 py-2.5 text-center text-xl font-mono tracking-[0.3em] outline-none focus:ring-1"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
          />
          {error && <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}
          <button
            onClick={submitCode}
            disabled={submitting || code.length < 6}
            className="mt-4 w-full rounded py-2.5 text-sm font-medium text-white transition disabled:opacity-60"
            style={{ background: "var(--color-accent)" }}
          >
            {submitting ? "Verifying…" : "Verify"}
          </button>
        </div>
      )}

      {step === "awaiting_talent" && (
        <div
          className="rounded border p-6 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="mb-4 flex justify-center">
            <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--color-accent)" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            Awaiting talent verification
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
            The talent has been notified and must complete their 2FA challenge. This page will update automatically.
          </p>
        </div>
      )}

      {step === "complete" && (
        <div>
          <div
            className="mb-4 rounded border p-4 text-sm"
            style={{ borderColor: "var(--color-border)", background: "#f0fdf4", color: "#166534" }}
          >
            Both verifications complete — download links are valid for 48 hours.
          </div>
          <div className="space-y-2">
            {tokens.map((t) => (
              <a
                key={t.token}
                href={`/api/download/${t.token}`}
                download={t.filename}
                className="flex items-center justify-between rounded border px-4 py-3 text-sm transition hover:shadow-sm"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}
              >
                <span className="truncate">{t.filename}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 ml-3" style={{ color: "var(--color-accent)" }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </a>
            ))}
          </div>
        </div>
      )}

      {step === "expired" && (
        <div className="rounded border p-5 text-center" style={{ borderColor: "var(--color-border)" }}>
          <p className="text-sm" style={{ color: "var(--color-danger)" }}>Session expired. Please try again.</p>
          <button
            onClick={() => { setStep("idle"); window.location.reload(); }}
            className="mt-3 text-xs underline"
            style={{ color: "var(--color-muted)" }}
          >
            Restart
          </button>
        </div>
      )}

      {step === "error" && (
        <p className="text-sm" style={{ color: "var(--color-danger)" }}>
          Something went wrong. Please go back and try again.
        </p>
      )}
    </div>
  );
}
