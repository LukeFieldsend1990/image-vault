"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface StatusData {
  step: string | null;
  downloadTokens?: Array<{ fileId: string; filename: string; token: string }>;
}

interface LicenceData {
  projectName: string;
  productionCompany: string;
  intendedUse: string;
  licenceType: string | null;
  territory: string | null;
  exclusivity: string | null;
  permitAiTraining: boolean;
  proposedFee: number | null;    // pence
  validFrom: number;
  validTo: number;
  packageName: string | null;
}

const LICENCE_TYPE_LABELS: Record<string, string> = {
  film_double: "Film / Double",
  game_character: "Game Character",
  commercial: "Commercial / Advertising",
  ai_avatar: "AI Avatar / Virtual Self",
  training_data: "AI Training Data",
  monitoring_reference: "Identity / Security Reference",
};

const EXCLUSIVITY_LABELS: Record<string, string> = {
  non_exclusive: "Non-exclusive",
  sole: "Sole",
  exclusive: "Exclusive",
};

function fmtDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtGBP(pence: number) {
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 0 })}`;
}

export default function TalentAuthoriseClient({ licenceId }: { licenceId: string }) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [licence, setLicence] = useState<LicenceData | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Status fetch is critical — drives the entire flow; failure shows error state
    const statusFetch = fetch(`/api/licences/${licenceId}/download/status`)
      .then((r) => r.json() as Promise<StatusData>)
      .catch((): StatusData => ({ step: null }));

    // Licence fetch is optional — enriches the UI only; failure is non-fatal
    const licenceFetch = fetch(`/api/licences/${licenceId}`)
      .then((r) => r.ok ? r.json() as Promise<{ licence?: LicenceData }> : Promise.resolve({} as { licence?: LicenceData }))
      .catch((): { licence?: LicenceData } => ({}));

    Promise.all([statusFetch, licenceFetch]).then(([statusData, licenceData]) => {
      setStatus(statusData);
      if (licenceData.licence) setLicence(licenceData.licence);
    });
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
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Invalid code");
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
      setCode("");
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
        <div className="rounded border p-6 text-center" style={{ borderColor: "var(--color-border)", background: "#f0fdf4" }}>
          <svg className="mx-auto mb-3" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="text-sm font-medium" style={{ color: "#166534" }}>Authorisation complete</p>
          <p className="mt-1 text-xs" style={{ color: "#166534" }}>The licensee can now download the files.</p>
        </div>
        <Link href="/vault/licences" className="mt-4 block text-center text-xs underline" style={{ color: "var(--color-muted)" }}>
          View licences
        </Link>
      </div>
    );
  }

  // ── Main authorise view ────────────────────────────────────────────────────

  const netEarnings = licence?.proposedFee ? Math.round(licence.proposedFee * 0.85) : null;

  return (
    <div className="p-8 max-w-xl">
      <Link href="/vault/authorise" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        Back
      </Link>

      <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--color-ink)" }}>Authorise Download</h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
        A production company has completed their verification. Review the request below and enter your authenticator code to authorise.
      </p>

      {/* ── AI Training Warning ─────────────────────────────────────────────── */}
      {licence?.permitAiTraining && (
        <div
          className="mb-5 rounded border p-4"
          style={{ borderColor: "#dc2626", background: "rgba(220,38,38,0.06)" }}
        >
          <div className="flex gap-2.5">
            <svg className="mt-0.5 flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div>
              <p className="text-xs font-semibold" style={{ color: "#dc2626" }}>AI Processing Requested</p>
              <p className="mt-0.5 text-xs" style={{ color: "#991b1b" }}>
                This licensee has requested permission to use your biometric data to train AI models or generate synthetic media. Review carefully before authorising.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Licence Summary ─────────────────────────────────────────────────── */}
      {licence && (
        <div
          className="mb-6 rounded border divide-y text-sm"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="px-4 py-3">
            <p className="font-medium" style={{ color: "var(--color-ink)" }}>{licence.projectName}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{licence.productionCompany}</p>
          </div>

          {(
            [
              licence.licenceType ? ["Usage type", LICENCE_TYPE_LABELS[licence.licenceType] ?? licence.licenceType] : null,
              licence.territory ? ["Territory", licence.territory] : null,
              licence.exclusivity ? ["Exclusivity", EXCLUSIVITY_LABELS[licence.exclusivity] ?? licence.exclusivity] : null,
              ["Licence period", `${fmtDate(licence.validFrom)} → ${fmtDate(licence.validTo)}`],
              ["AI processing", licence.permitAiTraining ? "Requested" : "Not requested"],
            ] as ([string, string] | null)[]
          )
            .filter((r): r is [string, string] => r !== null)
            .map(([key, value]) => (
              <div key={key} className="flex justify-between gap-4 px-4 py-2">
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>{key}</span>
                <span
                  className="text-xs font-medium"
                  style={{
                    color: key === "AI processing" && licence.permitAiTraining ? "#dc2626" : "var(--color-ink)",
                  }}
                >
                  {value}
                </span>
              </div>
            ))}

          {licence.intendedUse && (
            <div className="px-4 py-3">
              <p className="text-xs mb-1" style={{ color: "var(--color-muted)" }}>Stated intended use</p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink)" }}>{licence.intendedUse}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Earnings Projection ─────────────────────────────────────────────── */}
      {licence?.proposedFee && netEarnings !== null && (
        <div
          className="mb-6 rounded border p-4"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-xs font-semibold mb-3" style={{ color: "var(--color-ink)" }}>Fee Breakdown</p>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span style={{ color: "var(--color-muted)" }}>Proposed licence fee</span>
              <span style={{ color: "var(--color-ink)" }}>{fmtGBP(licence.proposedFee)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: "var(--color-muted)" }}>Platform fee (15%)</span>
              <span style={{ color: "var(--color-muted)" }}>−{fmtGBP(Math.round(licence.proposedFee * 0.15))}</span>
            </div>
            <div
              className="flex justify-between border-t pt-1.5 font-semibold"
              style={{ borderColor: "var(--color-border)" }}
            >
              <span style={{ color: "var(--color-ink)" }}>Your earnings</span>
              <span style={{ color: "var(--color-accent)" }}>{fmtGBP(netEarnings)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── 2FA Input ───────────────────────────────────────────────────────── */}
      <div
        className="rounded border p-6"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink)" }}>Enter your authenticator code</p>
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
          style={{
            borderColor: error ? "var(--color-danger)" : "var(--color-border)",
            background: "var(--color-bg)",
            color: "var(--color-ink)",
          }}
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
