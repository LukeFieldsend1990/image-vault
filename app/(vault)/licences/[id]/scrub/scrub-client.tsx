"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ScrubStatus = {
  licenceId: string;
  status: string;
  projectName: string;
  scrubDeadline: number | null;
  daysRemaining: number | null;
  overdue: boolean;
  scrubAttestedAt: number | null;
  attestation: {
    attestedAt: number;
    devicesScrubbed: unknown;
    bridgeCachePurged: boolean;
    additionalNotes: string | null;
  } | null;
};

const ATTESTATION_TEXT = `I confirm that all copies of the scan data licensed under this agreement have been permanently deleted from every device, storage system, and backup under my or my company's control. I understand that this attestation is a legally binding statement and that submitting a false attestation may result in civil or criminal liability.`;

function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
}

export default function ScrubAttestationClient({ licenceId }: { licenceId: string }) {
  const [state, setState] = useState<ScrubStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [devices, setDevices] = useState<string[]>([""]);
  const [notes, setNotes] = useState("");
  const [bridgeCachePurged, setBridgeCachePurged] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [totp, setTotp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/licences/${licenceId}/scrub`);
        const data = await r.json() as ScrubStatus | { error?: string };
        if (cancelled) return;
        if (!r.ok) {
          setLoadError((data as { error?: string }).error ?? "Could not load attestation status.");
          return;
        }
        setState(data as ScrubStatus);
      } catch {
        if (!cancelled) setLoadError("Network error.");
      }
    })();
    return () => { cancelled = true; };
  }, [licenceId]);

  async function submit() {
    setError(null);
    const cleanedDevices = devices.map((d) => d.trim()).filter(Boolean);
    if (cleanedDevices.length === 0) {
      setError("List at least one device where the data was held.");
      return;
    }
    if (!confirmed) {
      setError("You must tick the confirmation box to proceed.");
      return;
    }
    if (!totp.trim()) {
      setError("Enter your 6-digit authenticator code.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/licences/${licenceId}/scrub/attest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          devicesScrubbed: cleanedDevices,
          additionalNotes: notes.trim() || undefined,
          bridgeCachePurged,
          totp: totp.replace(/\s/g, ""),
        }),
      });
      const d = await res.json() as { error?: string; status?: string; attestedAt?: number };
      if (!res.ok) throw new Error(d.error ?? "Submission failed");
      setState((prev) => prev ? {
        ...prev,
        status: "CLOSED",
        scrubAttestedAt: d.attestedAt ?? Math.floor(Date.now() / 1000),
      } : prev);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  const header = (
    <>
      <Link
        href="/licences"
        className="mb-6 inline-flex items-center gap-1.5 text-xs"
        style={{ color: "var(--color-muted)" }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        My Licences
      </Link>
      <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--color-ink)" }}>
        Confirm data deletion
      </h1>
    </>
  );

  if (loadError) {
    return (
      <div className="p-8 max-w-lg">
        {header}
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>{loadError}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="p-8 max-w-lg">
        {header}
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>
      </div>
    );
  }

  const alreadyClosed = state.status === "CLOSED" || state.scrubAttestedAt !== null;

  if (alreadyClosed) {
    return (
      <div className="p-8 max-w-lg">
        {header}
        <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
          Project: <span style={{ color: "var(--color-ink)" }}>{state.projectName}</span>
        </p>
        <div
          className="rounded p-4 mb-6"
          style={{
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
          }}
        >
          <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>
            Attestation received
          </p>
          <p className="text-sm" style={{ color: "var(--color-ink)" }}>
            Submitted on {state.scrubAttestedAt ? formatDate(state.scrubAttestedAt) : "—"}. This licence is closed.
          </p>
        </div>
      </div>
    );
  }

  if (state.status !== "SCRUB_PERIOD" && state.status !== "OVERDUE") {
    return (
      <div className="p-8 max-w-lg">
        {header}
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No attestation is currently required for this licence. Status: {state.status}.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-lg">
      {header}

      <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
        Project: <span style={{ color: "var(--color-ink)" }}>{state.projectName}</span>
      </p>

      <div
        className="rounded p-4 mb-6"
        style={{
          border: "1px solid var(--color-border)",
          background: state.overdue ? "rgba(192,57,43,0.05)" : "var(--color-surface)",
        }}
      >
        <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>
          Deadline
        </p>
        <p className="text-sm" style={{ color: "var(--color-ink)" }}>
          {state.scrubDeadline ? formatDate(state.scrubDeadline) : "—"}
          {state.daysRemaining !== null && !state.overdue && (
            <> — <span style={{ color: "var(--color-muted)" }}>{state.daysRemaining} day{state.daysRemaining !== 1 ? "s" : ""} remaining</span></>
          )}
          {state.overdue && <> — <span style={{ color: "#c0392b" }}>overdue</span></>}
        </p>
      </div>

      <section className="mb-6">
        <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>
          Declaration
        </p>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-ink)" }}>
          {ATTESTATION_TEXT}
        </p>
      </section>

      <section className="mb-6">
        <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>
          Devices and storage systems
        </p>
        <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
          List every device, workstation, server, NAS, or backup location where a copy existed. Be specific — host name or asset tag is ideal.
        </p>
        {devices.map((d, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input
              type="text"
              value={d}
              onChange={(e) => setDevices((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder="e.g. VFX-WS-04 (Nuke workstation)"
              className="flex-1 rounded px-3 py-2 text-sm"
              style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}
            />
            {devices.length > 1 && (
              <button
                type="button"
                onClick={() => setDevices((prev) => prev.filter((_, j) => j !== i))}
                className="px-2 text-xs"
                style={{ color: "var(--color-muted)" }}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setDevices((prev) => [...prev, ""])}
          className="text-xs underline"
          style={{ color: "var(--color-muted)" }}
        >
          + Add another device
        </button>
      </section>

      <section className="mb-6">
        <label className="flex items-start gap-2 text-sm" style={{ color: "var(--color-ink)" }}>
          <input
            type="checkbox"
            checked={bridgeCachePurged}
            onChange={(e) => setBridgeCachePurged(e.target.checked)}
            className="mt-1"
          />
          <span>I have purged the Image Vault Bridge local cache on any device that used it.</span>
        </label>
      </section>

      <section className="mb-6">
        <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>
          Additional notes (optional)
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={3}
          className="w-full rounded px-3 py-2 text-sm"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}
        />
      </section>

      <section className="mb-6">
        <label className="flex items-start gap-2 text-sm" style={{ color: "var(--color-ink)" }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1"
          />
          <span>I confirm the declaration above is true, accurate, and made in my capacity as an authorised representative.</span>
        </label>
      </section>

      <section className="mb-6">
        <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>
          Two-factor code
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
          placeholder="123 456"
          className="rounded px-3 py-2 text-sm"
          style={{
            border: "1px solid var(--color-border)",
            background: "var(--color-bg)",
            width: "10rem",
            fontFamily: "ui-monospace, monospace",
            letterSpacing: "0.2em",
          }}
        />
      </section>

      {error && (
        <p className="text-sm mb-4" style={{ color: "#c0392b" }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="rounded px-5 py-2.5 text-sm font-medium"
        style={{
          background: "var(--color-ink)",
          color: "var(--color-bg)",
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? "Submitting…" : "Submit attestation"}
      </button>
    </div>
  );
}
