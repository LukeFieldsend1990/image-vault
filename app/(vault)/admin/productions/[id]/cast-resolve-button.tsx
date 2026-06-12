"use client";

import { useState } from "react";

/**
 * Minimal admin action for a placeholder cast row: prompt for an email and
 * promote the placeholder (POST /api/productions/[id]/cast/[castId]/resolve).
 * Terms come from whatever was stored on the placeholder; if they're missing
 * the API returns a 409 and we surface the message.
 */
export default function CastResolveButton({
  productionId,
  castId,
  actorName,
}: {
  productionId: string;
  castId: string;
  actorName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    const email = window.prompt(`Email to onboard ${actorName}:`)?.trim();
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/productions/${productionId}/cast/${castId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not resolve this cast member.");
        return;
      }
      location.reload();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        onClick={resolve}
        disabled={busy}
        className="text-[9px] uppercase tracking-wide font-semibold underline disabled:opacity-50"
        style={{ color: "var(--color-accent)" }}
      >
        {busy ? "Adding…" : "+ Add email"}
      </button>
      {error && <span className="text-[9px]" style={{ color: "#dc2626" }}>{error}</span>}
    </span>
  );
}
