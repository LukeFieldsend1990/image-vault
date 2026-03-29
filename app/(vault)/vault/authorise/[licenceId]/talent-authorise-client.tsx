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
  proposedFee: number | null;
  validFrom: number;
  validTo: number;
  packageName: string | null;
}

interface PendingPreauthRequest {
  requestedBy: string;
  repEmail: string;
  option: PreauthOption;
  requestedAt: number;
}

type PreauthOption = "once" | "7d" | "14d" | "30d" | "licence";

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

const PREAUTH_OPTIONS: { value: PreauthOption; label: string; desc: string }[] = [
  { value: "once",    label: "One-off",          desc: "This download only. Full dual-custody next time." },
  { value: "7d",      label: "7 days",            desc: "Licensee can download without your 2FA for 7 days." },
  { value: "14d",     label: "14 days",           desc: "Licensee can download without your 2FA for 14 days." },
  { value: "30d",     label: "30 days",           desc: "Licensee can download without your 2FA for 30 days." },
  { value: "licence", label: "Full licence period", desc: "No 2FA required until the licence expires." },
];

const REP_PREAUTH_OPTIONS = PREAUTH_OPTIONS.filter((o) => o.value !== "once");

function fmtDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtGBP(pence: number) {
  return `$${(pence / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

// ── Shared: licence summary card ─────────────────────────────────────────────
function LicenceSummary({ licence }: { licence: LicenceData }) {
  return (
    <div className="mb-6 rounded border divide-y text-sm" style={{ borderColor: "var(--color-border)" }}>
      <div className="px-4 py-3">
        <p className="font-medium" style={{ color: "var(--color-ink)" }}>{licence.projectName}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{licence.productionCompany}</p>
      </div>
      {([
        licence.licenceType ? ["Usage type", LICENCE_TYPE_LABELS[licence.licenceType] ?? licence.licenceType] : null,
        licence.territory ? ["Territory", licence.territory] : null,
        licence.exclusivity ? ["Exclusivity", EXCLUSIVITY_LABELS[licence.exclusivity] ?? licence.exclusivity] : null,
        ["Licence period", `${fmtDate(licence.validFrom)} → ${fmtDate(licence.validTo)}`],
        ["AI processing", licence.permitAiTraining ? "Requested" : "Not requested"],
      ] as ([string, string] | null)[])
        .filter((r): r is [string, string] => r !== null)
        .map(([key, value]) => (
          <div key={key} className="flex justify-between gap-4 px-4 py-2">
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>{key}</span>
            <span className="text-xs font-medium" style={{ color: key === "AI processing" && licence.permitAiTraining ? "#dc2626" : "var(--color-ink)" }}>
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
  );
}

// ── Talent: confirm a rep's preauth request ───────────────────────────────────
function ConfirmPreauthView({
  licenceId,
  licence,
  pending,
}: {
  licenceId: string;
  licence: LicenceData | null;
  pending: PendingPreauthRequest | null;
}) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const OPTION_LABELS: Record<string, string> = {
    "7d": "7 days", "14d": "14 days", "30d": "30 days", "licence": "the full licence period",
  };

  async function confirm() {
    if (code.length < 6) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/licences/${licenceId}/preauth/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.replace(/\s/g, "") }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed");
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="p-8 max-w-lg">
        <div className="rounded border p-6 text-center" style={{ borderColor: "var(--color-border)", background: "#f0fdf4" }}>
          <svg className="mx-auto mb-3" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="text-sm font-medium" style={{ color: "#166534" }}>Pre-authorisation confirmed</p>
          <p className="mt-1 text-xs" style={{ color: "#166534" }}>Your rep's request has been approved.</p>
        </div>
        <Link href="/vault/licences" className="mt-4 block text-center text-xs underline" style={{ color: "var(--color-muted)" }}>
          View licences
        </Link>
      </div>
    );
  }

  if (!pending) {
    return (
      <div className="p-8 max-w-lg">
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No pending pre-auth request found, or it has expired.</p>
        <Link href="/vault/licences" className="mt-4 block text-xs underline" style={{ color: "var(--color-muted)" }}>
          Back to licences
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-xl">
      <Link href="/vault/licences" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        Back to licences
      </Link>

      <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--color-ink)" }}>Confirm Pre-Authorisation</h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
        Your rep ({pending.repEmail}) has requested to pre-authorise downloads for{" "}
        <strong style={{ color: "var(--color-ink)" }}>{OPTION_LABELS[pending.option] ?? pending.option}</strong>.
        {" "}During this period, the licensee can download without your 2FA code.
      </p>

      {licence && <LicenceSummary licence={licence} />}

      <div className="rounded border p-5" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink)" }}>Enter your authenticator code to confirm</p>
        <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
          This confirms you agree to the pre-authorisation your rep has requested.
        </p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setError(null); }}
          onKeyDown={(e) => e.key === "Enter" && confirm()}
          placeholder="000 000"
          className="w-full rounded border px-3 py-2.5 text-center text-xl font-mono tracking-[0.3em] outline-none"
          style={{ borderColor: error ? "var(--color-danger)" : "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
        />
        {error && (
          <div className="mt-2 rounded px-3 py-2 text-xs font-medium" style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-danger)" }}>
            {error} — please wait for a new code and try again.
          </div>
        )}
        <button
          onClick={confirm}
          disabled={submitting || code.length < 6}
          className="mt-4 w-full rounded py-2.5 text-sm font-medium text-white transition disabled:opacity-60"
          style={{ background: "var(--color-accent)" }}
        >
          {submitting ? "Confirming…" : "Confirm Pre-Authorisation"}
        </button>
      </div>
    </div>
  );
}

// ── Rep: request preauth on talent's behalf ───────────────────────────────────
function RepRequestView({ licenceId, licence }: { licenceId: string; licence: LicenceData | null }) {
  const [selected, setSelected] = useState<PreauthOption>("7d");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function request() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/licences/${licenceId}/preauth/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option: selected }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Request failed");
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="p-8 max-w-lg">
        <div className="rounded border p-6 text-center" style={{ borderColor: "var(--color-border)", background: "#f0fdf4" }}>
          <svg className="mx-auto mb-3" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="text-sm font-medium" style={{ color: "#166534" }}>Request sent</p>
          <p className="mt-1 text-xs" style={{ color: "#166534" }}>The talent has been emailed to confirm the pre-authorisation with their 2FA code.</p>
        </div>
        <Link href="/vault/licences" className="mt-4 block text-center text-xs underline" style={{ color: "var(--color-muted)" }}>
          Back to licences
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-xl">
      <Link href="/vault/licences" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        Back to licences
      </Link>

      <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--color-ink)" }}>Request Pre-Authorisation</h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
        As the rep, you can request pre-authorisation on the talent's behalf.
        The talent will receive an email and must confirm with their 2FA code before it takes effect.
      </p>

      {licence && <LicenceSummary licence={licence} />}

      <div
        className="mb-4 rounded border p-4"
        style={{ borderColor: "#d97706", background: "rgba(217,119,6,0.06)" }}
      >
        <p className="text-xs" style={{ color: "#92400e" }}>
          <strong>Note:</strong> This download still requires the talent's physical verification to activate. One-off download authorisation always requires the talent's direct 2FA code — only future downloads can be pre-authorised.
        </p>
      </div>

      <div className="mb-6 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--color-muted)" }}>Pre-auth duration</p>
        {REP_PREAUTH_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className="flex items-start gap-3 rounded border px-4 py-3 cursor-pointer transition"
            style={{
              borderColor: selected === opt.value ? "var(--color-ink)" : "var(--color-border)",
              background: selected === opt.value ? "rgba(0,0,0,0.02)" : "transparent",
            }}
          >
            <input
              type="radio"
              name="preauth"
              value={opt.value}
              checked={selected === opt.value}
              onChange={() => setSelected(opt.value)}
              className="mt-0.5 shrink-0"
            />
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{opt.label}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{opt.desc}</p>
            </div>
          </label>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded px-3 py-2 text-xs font-medium" style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-danger)" }}>
          {error}
        </div>
      )}

      <button
        onClick={request}
        disabled={submitting}
        className="w-full rounded py-2.5 text-sm font-medium text-white transition disabled:opacity-60"
        style={{ background: "var(--color-accent)" }}
      >
        {submitting ? "Sending request…" : "Send Pre-Auth Request to Talent"}
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TalentAuthoriseClient({
  licenceId,
  role = "talent",
  confirmPreauth = false,
}: {
  licenceId: string;
  role?: string;
  confirmPreauth?: boolean;
}) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [licence, setLicence] = useState<LicenceData | null>(null);
  const [pendingPreauth, setPendingPreauth] = useState<PendingPreauthRequest | null | undefined>(undefined);
  const [code, setCode] = useState("");
  const [preauthOption, setPreauthOption] = useState<PreauthOption>("once");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const statusFetch = fetch(`/api/licences/${licenceId}/download/status`)
      .then((r) => r.json() as Promise<StatusData>)
      .catch((): StatusData => ({ step: null }));

    const licenceFetch = fetch(`/api/licences/${licenceId}`)
      .then((r) => r.ok ? r.json() as Promise<{ licence?: LicenceData }> : Promise.resolve({} as { licence?: LicenceData }))
      .catch((): { licence?: LicenceData } => ({}));

    const preauthFetch = confirmPreauth
      ? fetch(`/api/licences/${licenceId}/preauth/request`)
          .then((r) => r.ok ? r.json() as Promise<{ pending?: PendingPreauthRequest | null }> : Promise.resolve({ pending: null }))
          .catch(() => ({ pending: null }))
      : Promise.resolve({ pending: null });

    Promise.all([statusFetch, licenceFetch, preauthFetch]).then(([statusData, licenceData, preauthData]) => {
      setStatus(statusData);
      if (licenceData.licence) setLicence(licenceData.licence);
      setPendingPreauth(preauthData.pending ?? null);
    });
  }, [licenceId, confirmPreauth]);

  // ── Rep branch: request preauth or confirm-preauth mode ──────────────────
  if (status !== null && role === "rep" && !confirmPreauth) {
    return <RepRequestView licenceId={licenceId} licence={licence} />;
  }

  // ── Talent: confirm a rep's preauth request ───────────────────────────────
  if (confirmPreauth && pendingPreauth !== undefined) {
    return <ConfirmPreauthView licenceId={licenceId} licence={licence} pending={pendingPreauth} />;
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (status === null || (confirmPreauth && pendingPreauth === undefined)) {
    return <div className="p-8 text-sm" style={{ color: "var(--color-muted)" }}>Loading…</div>;
  }

  if (status.step === null || status.step === "expired") {
    return (
      <div className="p-8 max-w-lg">
        <Link href="/vault/licences" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back to licences
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
        <Link href="/vault/licences" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back to licences
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
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="text-sm font-medium" style={{ color: "#166534" }}>Authorisation complete</p>
          <p className="mt-1 text-xs" style={{ color: "#166534" }}>
            The licensee can now download the files.
            {preauthOption !== "once" && " Pre-authorisation has been set for future downloads."}
          </p>
        </div>
        <Link href="/vault/licences" className="mt-4 block text-center text-xs underline" style={{ color: "var(--color-muted)" }}>
          View licences
        </Link>
      </div>
    );
  }

  async function submit() {
    if (!code.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/licences/${licenceId}/download/talent-2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.replace(/\s/g, ""), preauthOption }),
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

  const netEarnings = licence?.proposedFee ? Math.round(licence.proposedFee * 0.85) : null;
  const aiTraining = !!licence?.permitAiTraining;

  return (
    <div className="p-8 max-w-xl">
      <Link href="/vault/licences" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        Back to licences
      </Link>

      <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--color-ink)" }}>Authorise Download</h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
        A production company has completed their verification. Review the request and enter your authenticator code to authorise.
      </p>

      {aiTraining && (
        <div className="mb-5 rounded border p-4" style={{ borderColor: "#dc2626", background: "rgba(220,38,38,0.06)" }}>
          <div className="flex gap-2.5">
            <svg className="mt-0.5 flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div>
              <p className="text-xs font-semibold" style={{ color: "#dc2626" }}>AI Processing Requested</p>
              <p className="mt-0.5 text-xs" style={{ color: "#991b1b" }}>
                This licensee has requested permission to use your biometric data to train AI models or generate synthetic media. Review carefully before authorising. Pre-authorisation is not available for AI training licences.
              </p>
            </div>
          </div>
        </div>
      )}

      {licence && <LicenceSummary licence={licence} />}

      {licence?.proposedFee && netEarnings !== null && (
        <div className="mb-6 rounded border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
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
            <div className="flex justify-between border-t pt-1.5 font-semibold" style={{ borderColor: "var(--color-border)" }}>
              <span style={{ color: "var(--color-ink)" }}>Your earnings</span>
              <span style={{ color: "var(--color-accent)" }}>{fmtGBP(netEarnings)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Pre-auth options ──────────────────────────────────────────────── */}
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--color-muted)" }}>Authorisation scope</p>
        {aiTraining && (
          <p className="text-xs mb-3 italic" style={{ color: "var(--color-muted)" }}>
            Pre-authorisation is disabled for AI training licences. Only one-off is available.
          </p>
        )}
        <div className="space-y-2">
          {PREAUTH_OPTIONS.map((opt) => {
            const disabled = aiTraining && opt.value !== "once";
            return (
              <label
                key={opt.value}
                className="flex items-start gap-3 rounded border px-4 py-3 transition"
                style={{
                  borderColor: preauthOption === opt.value ? "var(--color-ink)" : "var(--color-border)",
                  background: preauthOption === opt.value ? "rgba(0,0,0,0.02)" : "transparent",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.4 : 1,
                }}
              >
                <input
                  type="radio"
                  name="preauth"
                  value={opt.value}
                  checked={preauthOption === opt.value}
                  onChange={() => !disabled && setPreauthOption(opt.value)}
                  disabled={disabled}
                  className="mt-0.5 shrink-0"
                />
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{opt.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{opt.desc}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* ── 2FA Input ──────────────────────────────────────────────────────── */}
      <div className="rounded border p-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
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
          className="w-full rounded border px-3 py-2.5 text-center text-xl font-mono tracking-[0.3em] outline-none"
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
          {submitting ? "Verifying…" : preauthOption === "once" ? "Authorise Download" : "Authorise & Set Pre-Auth"}
        </button>
      </div>
    </div>
  );
}
