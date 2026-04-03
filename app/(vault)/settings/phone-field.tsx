"use client";

import { useEffect, useState } from "react";

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export default function PhoneField() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings/phone")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const d = data as { phone?: string } | null;
        if (d?.phone) setPhone(d.phone);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setError("");
    setSaved(false);

    if (!E164_REGEX.test(phone)) {
      setError("Please enter a valid phone number (e.g., +447700900123)");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings/phone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Failed to save phone number");
        return;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor="phone"
        className="block text-xs font-medium tracking-wide uppercase"
        style={{ color: "var(--color-muted)" }}
      >
        Phone number
      </label>

      <div className="flex items-center gap-2">
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setError("");
            setSaved(false);
          }}
          placeholder={loading ? "Loading..." : "+447700900123"}
          disabled={loading}
          className="block w-full border bg-white px-3 py-2 text-sm outline-none transition focus:border-[--color-accent] disabled:opacity-50"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-ink)",
            borderRadius: "var(--radius)",
          }}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading}
          className="btn-accent shrink-0 px-4 py-2 text-xs font-medium text-white transition disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {saved && (
        <p className="text-xs" style={{ color: "var(--color-accent)" }}>
          Saved
        </p>
      )}
    </div>
  );
}
