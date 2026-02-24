"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LicenceRequestClient({ packageId }: { packageId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    projectName: "",
    productionCompany: "",
    intendedUse: "",
    validFrom: "",
    validTo: "",
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.projectName || !form.productionCompany || !form.intendedUse || !form.validFrom || !form.validTo) {
      setError("All fields are required.");
      return;
    }
    const vf = Math.floor(new Date(form.validFrom).getTime() / 1000);
    const vt = Math.floor(new Date(form.validTo).getTime() / 1000);
    if (vt <= vf) {
      setError("End date must be after start date.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/licences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId,
          projectName: form.projectName,
          productionCompany: form.productionCompany,
          intendedUse: form.intendedUse,
          validFrom: vf,
          validTo: vt,
          fileScope: "all",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      router.push("/licences");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const labelClass = "block text-xs font-medium mb-1.5";
  const inputClass = "w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 transition";
  const inputStyle = {
    borderColor: "var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
  };

  return (
    <div className="p-8 max-w-lg">
      <Link href="/directory" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        Back
      </Link>

      <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--color-ink)" }}>Request Licence</h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-muted)" }}>
        Complete the form below. The talent will review your request and approve or deny within their own timeline.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>Project name</label>
          <input
            type="text"
            value={form.projectName}
            onChange={(e) => set("projectName", e.target.value)}
            placeholder="e.g. The Odyssey (2025)"
            className={inputClass}
            style={inputStyle}
          />
        </div>

        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>Production company</label>
          <input
            type="text"
            value={form.productionCompany}
            onChange={(e) => set("productionCompany", e.target.value)}
            placeholder="e.g. Universal Pictures"
            className={inputClass}
            style={inputStyle}
          />
        </div>

        <div>
          <label className={labelClass} style={{ color: "var(--color-text)" }}>Intended use</label>
          <textarea
            value={form.intendedUse}
            onChange={(e) => set("intendedUse", e.target.value)}
            placeholder="Describe how the likeness scan will be used in the production…"
            rows={4}
            className={inputClass}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} style={{ color: "var(--color-text)" }}>Licence start</label>
            <input
              type="date"
              value={form.validFrom}
              onChange={(e) => set("validFrom", e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className={labelClass} style={{ color: "var(--color-text)" }}>Licence end</label>
            <input
              type="date"
              value={form.validTo}
              onChange={(e) => set("validTo", e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>
        </div>

        <div
          className="rounded border p-4 text-xs leading-relaxed"
          style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
        >
          By submitting this request I confirm that the stated use is accurate, that my organisation will handle all biometric scan data in compliance with applicable data protection legislation, and that access is subject to talent approval and a mandatory dual-custody verification step before any files can be downloaded.
        </div>

        {error && (
          <p className="text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded py-2.5 text-sm font-medium text-white transition disabled:opacity-60"
          style={{ background: "var(--color-accent)" }}
        >
          {submitting ? "Submitting…" : "Submit Licence Request"}
        </button>
      </form>
    </div>
  );
}
